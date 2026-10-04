import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ cookie: undefined as string | undefined, queries: [] as string[], setCookie: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: () => state.cookie ? { value: state.cookie } : undefined,
  set: state.setCookie,
}) }));
vi.mock("@/lib/rate-limit", async (original) => ({ ...await original<typeof import("@/lib/rate-limit")>(), enforceRateLimit: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  client.$on("query", (event) => { state.queries.push(event.query); });
  return { db: client };
});

import { db } from "@/lib/db";
import { currentUser, requireAdmin, requirePasswordResetApprover, requireUser, requireVideoReviewOperator } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/security";
import { POST as changePassword } from "@/app/api/auth/password/route";

const describeDb = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
describeDb("session read path", () => {
  const prefix = `session-read-${crypto.randomUUID()}`;
  const sessionId = `${prefix}-live`;
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    const user = await db.user.create({ data: {
      kuaishouId: prefix, nickname: "会话读取测试", passwordHash: "synthetic-password-hash",
      boundPhoneEnc: "synthetic-encrypted-phone", avatarUrl: "/avatars/default.webp", guildStatus: "已入会", invited: true,
      account: { create: { balance: 120 } },
      sessions: { create: { id: sessionId, expiresAt: new Date(Date.now() + 3_600_000) } },
    }, include: { account: true } });
    userId = user.id;
    accountId = user.account!.id;
  });
  beforeEach(async () => {
    await db.user.update({ where: { id: userId }, data: { active: true, role: "MEMBER" } });
    state.cookie = sessionId;
    state.queries.length = 0;
  });
  afterAll(async () => {
    if (userId) {
      await db.auditLog.deleteMany({ where: { actorId: userId } });
      await db.session.deleteMany({ where: { userId } });
      await db.pointAccount.deleteMany({ where: { userId } });
      await db.user.delete({ where: { id: userId } });
    }
    await db.$disconnect();
  });

  it("reads identity in one SQL query without credentials, phone or account data", async () => {
    const user = await currentUser();
    expect(user).toEqual({ id: userId, kuaishouId: prefix, nickname: "会话读取测试", role: "MEMBER", active: true });
    expect(state.queries).toHaveLength(1);
    expect(state.queries[0]).not.toMatch(/passwordHash|boundPhoneEnc|PointAccount|avatarUrl/);
  });

  it("preserves the requested profile and current balance without private fields", async () => {
    const user = await currentUser({ profile: true });
    expect(user).toEqual({ id: userId, kuaishouId: prefix, nickname: "会话读取测试", role: "MEMBER", active: true,
      avatarUrl: "/avatars/default.webp", guildStatus: "已入会", invited: true, account: { id: accountId, balance: 120 } });
    expect(state.queries).toHaveLength(2);
    expect(state.queries.join("\n")).not.toMatch(/passwordHash|boundPhoneEnc/);
    await db.pointAccount.update({ where: { id: accountId }, data: { balance: 121 } });
    expect((await currentUser({ profile: true }))?.account?.balance).toBe(121);
    await db.pointAccount.update({ where: { id: accountId }, data: { balance: 120 } });
  });

  it("does not access the database without a cookie", async () => {
    state.cookie = undefined;
    expect(await currentUser()).toBeNull();
    expect(state.queries).toHaveLength(0);
    await expect(requireUser()).rejects.toThrow("请先登录");
  });

  it("rejects expired, absent and revoked sessions", async () => {
    const expiredId = `${prefix}-expired`;
    await db.session.create({ data: { id: expiredId, userId, expiresAt: new Date(Date.now() - 60_000) } });
    state.cookie = expiredId;
    expect(await currentUser()).toBeNull();
    await db.session.delete({ where: { id: expiredId } });
    expect(await currentUser({ profile: true })).toBeNull();
    state.cookie = `${prefix}-absent`;
    expect(await currentUser()).toBeNull();
  });

  it("observes disabled accounts immediately without caching identity", async () => {
    expect(await currentUser()).not.toBeNull();
    await db.user.update({ where: { id: userId }, data: { active: false } });
    expect(await currentUser()).toBeNull();
    expect(await currentUser({ profile: true })).toBeNull();
    await expect(requireAdmin()).rejects.toThrow("请先登录");
  });

  it("observes current roles on every server-side authorization check", async () => {
    await expect(requireAdmin()).rejects.toThrow("无权执行此操作");
    await expect(requireVideoReviewOperator()).rejects.toThrow("无权执行此操作");
    await db.user.update({ where: { id: userId }, data: { role: "REVIEWER" } });
    expect((await requireVideoReviewOperator()).id).toBe(userId);
    expect((await requirePasswordResetApprover()).id).toBe(userId);
    await expect(requireAdmin()).rejects.toThrow("无权执行此操作");
    await db.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
    expect((await requireAdmin()).id).toBe(userId);
    await db.user.update({ where: { id: userId }, data: { role: "MEMBER" } });
    await expect(requireAdmin()).rejects.toThrow("无权执行此操作");
  });

  it("supports a profile without a points account", async () => {
    const member = await db.user.create({ data: {
      kuaishouId: `${prefix}-no-account`, nickname: "无账户测试", passwordHash: "synthetic",
      sessions: { create: { id: `${prefix}-no-account`, expiresAt: new Date(Date.now() + 60_000) } },
    } });
    try {
      state.cookie = `${prefix}-no-account`;
      expect((await currentUser({ profile: true }))?.account).toBeNull();
    } finally {
      await db.session.deleteMany({ where: { userId: member.id } });
      await db.user.delete({ where: { id: member.id } });
    }
  });

  it("changes passwords through an explicit credential read and replaces old sessions", async () => {
    await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword("old-test-password") } });
    const request = (currentPassword: string) => new Request("http://localhost/api/auth/password", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ currentPassword, newPassword: "new-test-password" }),
    });
    expect((await changePassword(request("incorrect-password"))).status).toBe(400);
    expect(await db.session.count({ where: { id: sessionId } })).toBe(1);
    expect(state.setCookie).not.toHaveBeenCalled();
    const response = await changePassword(request("old-test-password"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const credential = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    expect(await verifyPassword(credential.passwordHash, "new-test-password")).toBe(true);
    expect(await db.session.count({ where: { id: sessionId } })).toBe(0);
    expect(await db.session.count({ where: { userId } })).toBe(1);
    expect(await db.auditLog.count({ where: { actorId: userId, action: "PASSWORD_CHANGED" } })).toBe(1);
    expect(state.setCookie).toHaveBeenCalledWith("miaomiao_session", expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
    expect(await currentUser()).toBeNull();
  });
});

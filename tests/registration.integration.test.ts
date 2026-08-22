import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createRegistrationInviteLink, getRegistrationApplicationStatus, reviewRegistrationApplication, submitRegistrationApplication } from "@/lib/registration";
import { hashPassword } from "@/lib/security";

const enabled = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("受控入团申请数据库流程", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let reviewerId = "";
  let inviteToken = "";
  const linkIds: string[] = [];
  const applicationIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const reviewer = await db.user.create({ data: { kuaishouId: `registration-reviewer-${suffix}`, nickname: "入团审核员", passwordHash: await hashPassword("reviewer-password"), role: "REVIEWER", account: { create: { balance: 0 } } } });
    reviewerId = reviewer.id;
    const created = await createRegistrationInviteLink({ actorId: reviewerId, expiresAt: null });
    inviteToken = created.token;
    linkIds.push(created.link.id);
  });

  afterEach(async () => {
    if (applicationIds.length) await db.registrationApplication.deleteMany({ where: { id: { in: applicationIds } } });
  });

  afterAll(async () => {
    if (linkIds.length) await db.registrationInviteLink.deleteMany({ where: { id: { in: linkIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (reviewerId) {
      await db.auditLog.deleteMany({ where: { actorId: reviewerId } });
      await db.user.delete({ where: { id: reviewerId } });
    }
    await db.$disconnect();
  });

  it("does not create an account until approval, then creates all member records", async () => {
    const kuaishouId = `new-member-${suffix}`;
    const submitted = await submitRegistrationApplication({ token: inviteToken, kuaishouId, nickname: "待审核成员", password: "member-password", guildStatus: "已入会" });
    applicationIds.push(submitted.applicationId);
    expect(submitted.status).toBe("PENDING");
    expect(await db.user.findFirst({ where: { kuaishouId: { equals: kuaishouId, mode: "insensitive" } } })).toBeNull();
    const approved = await reviewRegistrationApplication({ applicationId: submitted.applicationId, action: "APPROVE", reviewer: { id: reviewerId, role: "REVIEWER" } });
    expect(approved.status).toBe("APPROVED");
    userIds.push(approved.userId!);
    const user = await db.user.findUniqueOrThrow({ where: { id: approved.userId }, include: { account: true } });
    expect(user).toMatchObject({ kuaishouId, nickname: "待审核成员", role: "MEMBER", active: true, account: { balance: 0 } });
  });

  it("rejects a pending application with a reason and keeps the status query protected", async () => {
    const created = await createRegistrationInviteLink({ actorId: reviewerId, expiresAt: null });
    inviteToken = created.token;
    linkIds.push(created.link.id);
    const submitted = await submitRegistrationApplication({ token: created.token, kuaishouId: `rejected-member-${suffix}`, nickname: "待驳回成员", password: "member-password", guildStatus: "未绑定", boundPhone: "13800138000" });
    applicationIds.push(submitted.applicationId);
    await expect(getRegistrationApplicationStatus({ applicationId: submitted.applicationId, queryToken: "wrong-query-token" })).rejects.toThrow("查询凭证");
    const result = await reviewRegistrationApplication({ applicationId: submitted.applicationId, action: "REJECT", reason: "请补充公会信息", reviewer: { id: reviewerId, role: "REVIEWER" } });
    expect(result.status).toBe("REJECTED");
    const status = await getRegistrationApplicationStatus({ applicationId: submitted.applicationId, queryToken: submitted.queryToken });
    expect(status).toMatchObject({ status: "REJECTED", reviewReason: "请补充公会信息" });
  });
});

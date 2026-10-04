import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../lib/db";
import { createPlatformBindingRequest, requireVerifiedVideoAuthor, reviewPlatformBindingRequest, revokePlatformBinding } from "../lib/platform-bindings";
import { creditVideoReward, resolveVideoAppeal } from "../lib/points";
import { processVideoSubmission } from "../lib/video-jobs";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/kuaishou-fetch", () => ({ fetchKuaishouVideo: fetchMock }));

const enabled = process.env.RUN_DB_TESTS === "1";
const users: string[] = [];
let adminId = "";
const proofNote = "已在平台私信中核对发送账号的实际 UID，收到成员本次完整挑战码，时间与本次申请一致。";

async function member(role: "MEMBER" | "ADMIN" = "MEMBER") {
  const row = await db.user.create({ data: { kuaishouId: `binding-${randomUUID()}`, nickname: "同名成员", passwordHash: "synthetic-test", role, account: { create: {} } } });
  users.push(row.id);
  return row;
}

async function videoFor(userId: string, authorUid: string | null = `author_${randomUUID()}`, sourceKind = "long-link") {
  return db.videoSubmission.create({ data: { userId, sourceKind, sourceUrl: "https://www.kuaishou.com/short-video/123", requestUrl: "https://www.kuaishou.com/short-video/123", photoId: `photo_${randomUUID()}`, likes: 250, publishedAt: new Date(), metadataFetchedAt: new Date(), fetchedAuthorUid: authorUid, authorEvidenceVersion: 1, fetchedOwner: "同名成员", matchedOwner: true, submittedNickname: "同名成员", idempotencyKey: randomUUID() } });
}

async function approve(request: Awaited<ReturnType<typeof createPlatformBindingRequest>>) {
  return reviewPlatformBindingRequest({ requestId: request.id, actorId: adminId, action: "approve", challenge: request.challenge, proofMethod: "PLATFORM_MESSAGE", proofNote, confirmedControl: true });
}

describe.skipIf(!enabled)("verified platform account boundaries", () => {
  beforeAll(async () => { adminId = (await member("ADMIN")).id; });
  afterAll(async () => {
    const accounts = await db.pointAccount.findMany({ where: { userId: { in: users } }, select: { id: true } });
    await db.pointLedger.deleteMany({ where: { accountId: { in: accounts.map((row) => row.id) } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  it("does not credit a same-nickname video without verified ownership", async () => {
    const user = await member();
    const video = await videoFor(user.id);
    await expect(creditVideoReward({ videoId: video.id, userId: user.id, points: 50 })).rejects.toThrow("验证");
    expect(await db.pointLedger.count({ where: { referenceId: video.id } })).toBe(0);
  });

  it("does not let an appeal bypass missing author evidence", async () => {
    const user = await member();
    const video = await videoFor(user.id, null);
    await db.videoSubmission.update({ where: { id: video.id }, data: { status: "REJECTED" } });
    const appeal = await db.videoAppeal.create({ data: { userId: user.id, videoId: video.id, reason: "申诉测试", idempotencyKey: randomUUID() } });
    await expect(resolveVideoAppeal({ appealId: appeal.id, actorId: adminId, action: "approve", points: 50 })).rejects.toThrow("UID");
    expect(await db.pointLedger.count({ where: { referenceId: video.id } })).toBe(0);
  });

  it("issues one unpredictable expiring challenge from server-observed evidence", async () => {
    const user = await member();
    const video = await videoFor(user.id);
    const [a, b] = await Promise.all([createPlatformBindingRequest({ userId: user.id, videoId: video.id }), createPlatformBindingRequest({ userId: user.id, videoId: video.id })]);
    expect(a.id).toBe(b.id);
    expect(a.challenge).toMatch(/^MM-[A-Za-z0-9_-]{24}$/);
    expect(a.authorUid).toBe(video.fetchedAuthorUid);
    const other = await member();
    await expect(createPlatformBindingRequest({ userId: other.id, videoId: video.id })).rejects.toMatchObject({ status: 404 });
    await db.videoSubmission.update({ where: { id: video.id }, data: { authorEvidenceVersion: null } });
    await expect(createPlatformBindingRequest({ userId: user.id, videoId: video.id })).rejects.toThrow("UID");
  });

  it("requires explicit control evidence, a matching challenge and an active administrator", async () => {
    const user = await member();
    const video = await videoFor(user.id);
    const request = await createPlatformBindingRequest({ userId: user.id, videoId: video.id });
    await expect(reviewPlatformBindingRequest({ requestId: request.id, actorId: user.id, action: "approve" })).rejects.toMatchObject({ status: 403 });
    await expect(reviewPlatformBindingRequest({ requestId: request.id, actorId: adminId, action: "approve", proofNote: "只看到了同名公开主页" })).rejects.toThrow("控制权");
    await expect(reviewPlatformBindingRequest({ requestId: request.id, actorId: adminId, action: "approve", challenge: "wrong", proofMethod: "PLATFORM_MESSAGE", proofNote, confirmedControl: true })).rejects.toThrow("控制权");
    expect(await db.platformAccountBinding.count({ where: { userId: user.id } })).toBe(0);
  });

  it("rejects self verification and expired or changed work evidence", async () => {
    const ownVideo = await videoFor(adminId);
    const own = await createPlatformBindingRequest({ userId: adminId, videoId: ownVideo.id });
    await expect(approve(own)).rejects.toThrow("自己");
    const user = await member();
    const video = await videoFor(user.id);
    const request = await createPlatformBindingRequest({ userId: user.id, videoId: video.id });
    await db.platformBindingRequest.update({ where: { id: request.id }, data: { expiresAt: new Date(0) } });
    await expect(approve(request)).rejects.toThrow("过期");
    const replacement = await createPlatformBindingRequest({ userId: user.id, videoId: video.id });
    expect(replacement.challenge).not.toBe(request.challenge);
    await db.videoSubmission.update({ where: { id: video.id }, data: { fetchedAuthorUid: "changed-author" } });
    await expect(approve(replacement)).rejects.toThrow("证据已变化");
  });

  it("binds and audits exactly once, while changed replay evidence conflicts", async () => {
    const user = await member();
    const video = await videoFor(user.id);
    const request = await createPlatformBindingRequest({ userId: user.id, videoId: video.id });
    const results = await Promise.all([approve(request), approve(request)]);
    expect(results.every((row) => row.status === "APPROVED")).toBe(true);
    const binding = await db.$transaction((tx) => requireVerifiedVideoAuthor(tx, video));
    expect(await db.auditLog.count({ where: { entityId: binding.id, action: "PLATFORM_BINDING_VERIFIED" } })).toBe(1);
    await expect(reviewPlatformBindingRequest({ requestId: request.id, actorId: adminId, action: "approve", challenge: request.challenge, proofMethod: "PLATFORM_MESSAGE", proofNote: `${proofNote} changed`, confirmedControl: true })).rejects.toMatchObject({ status: 409 });
    await db.user.update({ where: { id: user.id }, data: { nickname: "完全改名" } });
    await expect(creditVideoReward({ videoId: video.id, userId: user.id, points: 50 })).resolves.toMatchObject({ status: "APPROVED", verifiedBindingId: binding.id });
  });

  it("allows only one member to win a concurrent claim to the same platform UID", async () => {
    const a = await member();
    const b = await member();
    const uid = `shared_${randomUUID()}`;
    const videos = await Promise.all([videoFor(a.id, uid), videoFor(b.id, uid)]);
    const requests = await Promise.all(videos.map((video) => createPlatformBindingRequest({ userId: video.userId, videoId: video.id })));
    const results = await Promise.allSettled(requests.map(approve));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.platformAccountBinding.count({ where: { platform: "kuaishou", authorUid: uid } })).toBe(1);
    const binding = await db.platformAccountBinding.findUniqueOrThrow({ where: { platform_authorUid: { platform: "kuaishou", authorUid: uid } } });
    const losing = videos.find((video) => video.userId !== binding.userId)!;
    await expect(db.$transaction((tx) => requireVerifiedVideoAuthor(tx, losing))).rejects.toThrow("验证");
  });

  it("revokes future credit without rewriting historical approved videos or releasing UID ownership", async () => {
    const user = await member();
    const video = await videoFor(user.id);
    await approve(await createPlatformBindingRequest({ userId: user.id, videoId: video.id }));
    const binding = await db.$transaction((tx) => requireVerifiedVideoAuthor(tx, video));
    await creditVideoReward({ videoId: video.id, userId: user.id, points: 50 });
    await revokePlatformBinding({ bindingId: binding.id, actorId: adminId, reason: "成员报告平台账号失去控制" });
    expect((await db.videoSubmission.findUniqueOrThrow({ where: { id: video.id } })).status).toBe("APPROVED");
    const next = await videoFor(user.id, video.fetchedAuthorUid);
    await expect(creditVideoReward({ videoId: next.id, userId: user.id, points: 50 })).rejects.toThrow("验证");
    const other = await member();
    const stolen = await videoFor(other.id, video.fetchedAuthorUid);
    await expect(createPlatformBindingRequest({ userId: other.id, videoId: stolen.id })).rejects.toThrow("占用");
    await expect(db.platformAccountBinding.update({ where: { id: binding.id }, data: { userId: other.id } })).rejects.toThrow("immutable");
  });

  it("waits for a concurrent revocation and rechecks ownership before crediting", async () => {
    const user = await member();
    const video = await videoFor(user.id);
    await approve(await createPlatformBindingRequest({ userId: user.id, videoId: video.id }));
    const binding = await db.$transaction((tx) => requireVerifiedVideoAuthor(tx, video));
    let release: () => void = () => undefined;
    let signal: (pid: number) => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<number>((resolve) => { signal = resolve; });
    const revocation = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`platform-author:${binding.platform}:${binding.authorUid}`})::bigint)`;
      await tx.platformAccountBinding.update({ where: { id: binding.id }, data: { revokedAt: new Date() } });
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      signal(backend.pid);
      await gate;
    }, { timeout: 10_000 });
    const holderPid = await locked;
    const credit = creditVideoReward({ videoId: video.id, userId: user.id, points: 50 }).then(() => "credited", (error: Error) => error.message);
    try {
      await expect.poll(async () => {
        const [row] = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event = 'advisory' AND ${holderPid} = ANY(pg_blocking_pids(pid))) AS waiting`;
        return row.waiting;
      }, { timeout: 3000, interval: 25 }).toBe(true);
    } finally { release(); await revocation; }
    expect(await credit).toContain("验证");
    expect(await db.pointLedger.count({ where: { referenceId: video.id } })).toBe(0);
    expect((await db.videoSubmission.findUniqueOrThrow({ where: { id: video.id } })).status).toBe("PROCESSING");
  });

  it("automatically rejects nickname-only evidence and approves a bound UID after a nickname change", async () => {
    const user = await member();
    const missing = await videoFor(user.id, null);
    const response = { source: { platform: "kuaishou", sourceUrl: missing.sourceUrl, requestUrl: missing.requestUrl, sourceKind: "long-link" }, likes: 250, views: null, commentCount: null, caption: null, coverUrl: null, publishedAt: new Date(), photoId: missing.photoId, owner: "同名成员", authorUid: null, points: 50, rawHtml: "", ownerMatches: true, ownerMatchMethod: "exact" };
    fetchMock.mockResolvedValue(response);
    await expect(processVideoSubmission(missing.id)).resolves.toMatchObject({ status: "REJECTED", matchedOwner: false, points: 0 });
    expect(await db.pointLedger.count({ where: { referenceId: missing.id } })).toBe(0);
    const owned = await videoFor(user.id);
    await approve(await createPlatformBindingRequest({ userId: user.id, videoId: owned.id }));
    fetchMock.mockResolvedValue({ ...response, photoId: owned.photoId, authorUid: owned.fetchedAuthorUid, owner: "完全不同的新昵称", ownerMatches: false, ownerMatchMethod: "none" });
    await expect(processVideoSubmission(owned.id)).resolves.toMatchObject({ status: "APPROVED", matchedOwner: true, fetchedOwner: "完全不同的新昵称", points: 50 });
    expect(await db.pointLedger.count({ where: { referenceId: owned.id, type: "VIDEO_REWARD" } })).toBe(1);
  });
});

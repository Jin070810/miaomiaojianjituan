import { seedVerifiedVideoAuthor } from "./helpers/verified-author";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { DEFAULT_VIDEO_POINT_RULE } from "@/lib/point-rules";
import { calculateVideoPoints, normalizeKuaishouLink } from "@/lib/kuaishou";
import { fetchKuaishouVideo } from "@/lib/kuaishou-fetch";
import { prepareVideoReprocess, processVideoSubmission } from "@/lib/video-jobs";
import { creditVideoReward, resolveVideoAppeal } from "@/lib/points";
import { captureVideoPointRule, snapshotRule, videoRuleEvidence, videoRuleRevision } from "@/lib/video-point-rule-snapshots";

vi.mock("@/lib/kuaishou-fetch", () => ({ fetchKuaishouVideo: vi.fn() }));
const fetchMock = vi.mocked(fetchKuaishouVideo);
const enabled = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("视频积分规则锁定", () => {
  let memberId = "";
  let adminId = "";
  let originalRule: Awaited<ReturnType<typeof db.videoPointRule.findUnique>>;
  const videoIds: string[] = [];
  const appealIds: string[] = [];
  let ownerMatches = false;

  beforeAll(async () => {
    originalRule = await db.videoPointRule.findUnique({ where: { id: "default" } });
    const [member, admin] = await Promise.all([
      db.user.create({ data: { kuaishouId: `rule-member-${randomUUID()}`, nickname: "规则测试", passwordHash: "test", account: { create: {} } } }),
      db.user.create({ data: { kuaishouId: `rule-admin-${randomUUID()}`, nickname: "规则管理员", passwordHash: "test", role: "ADMIN" } }),
    ]);
    memberId = member.id;
    adminId = admin.id;
  });

  beforeEach(async () => {
    await db.videoPointRule.upsert({ where: { id: "default" }, create: { ...DEFAULT_VIDEO_POINT_RULE }, update: { ...DEFAULT_VIDEO_POINT_RULE } });
    ownerMatches = false;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url, nickname, rule = DEFAULT_VIDEO_POINT_RULE) => ({
      source: normalizeKuaishouLink(url), likes: 500, views: 800, commentCount: 0,
      caption: null, coverUrl: null, publishedAt: new Date(), photoId: `rule-photo-${url.split("/").at(-1)}`,
      authorUid: ownerMatches ? `fixture_${memberId}` : null, owner: nickname, points: calculateVideoPoints(500, rule), rawHtml: "", ownerMatches, ownerMatchMethod: "exact",
    }));
  });

  afterAll(async () => {
    if (originalRule) await db.videoPointRule.upsert({ where: { id: "default" }, create: originalRule, update: originalRule });
    else await db.videoPointRule.deleteMany({ where: { id: "default" } });
    await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...videoIds, ...appealIds] } }, { actorId: adminId }] } });
    await db.pointLedger.deleteMany({ where: { account: { userId: memberId } } });
    await db.user.deleteMany({ where: { id: { in: [memberId, adminId].filter(Boolean) } } });
    await db.$disconnect();
  });

  async function createVideo() {
    const key = randomUUID();
    const url = `https://v.kuaishou.com/${key.replaceAll("-", "")}`;
    const video = await db.videoSubmission.create({ data: {
      userId: memberId, sourceUrl: url, requestUrl: url, sourceKind: "short-link", submittedNickname: "规则测试", idempotencyKey: key,
    } });
    videoIds.push(video.id);
    await seedVerifiedVideoAuthor(video.id);
    return video;
  }

  it("规则修改后，申诉仍按第一次自动审核规则入账", async () => {
    const video = await createVideo();
    expect((await processVideoSubmission(video.id))?.status).toBe("REJECTED");
    await db.videoPointRule.update({ where: { id: "default" }, data: { fixedTierPoints: 80 } });
    await seedVerifiedVideoAuthor(video.id);
    const appeal = await db.videoAppeal.create({ data: { videoId: video.id, userId: memberId, reason: "归属核验通过", idempotencyKey: randomUUID() } });
    appealIds.push(appeal.id);
    const approved = await resolveVideoAppeal({ appealId: appeal.id, action: "approve", actorId: adminId });
    expect(approved.reviewedPoints).toBe(50);
    expect(await db.pointLedger.findMany({ where: { referenceId: video.id, type: "VIDEO_REWARD" }, select: { amount: true } })).toEqual([{ amount: 50 }]);
  });

  it("第一次网络抓取失败后，重试沿用已锁定规则", async () => {
    const video = await createVideo();
    ownerMatches = true;
    fetchMock.mockRejectedValueOnce(new Error("synthetic network timeout"));
    await expect(processVideoSubmission(video.id)).rejects.toThrow("synthetic network timeout");
    await db.videoPointRule.update({ where: { id: "default" }, data: { fixedTierPoints: 80 } });
    await db.videoProcessingState.update({ where: { videoId: video.id }, data: { nextAttemptAt: new Date(0) } });
    expect((await processVideoSubmission(video.id))?.points).toBe(50);
    expect(fetchMock.mock.calls.map((call) => call[2]?.fixedTierPoints)).toEqual([50, 50]);
  });

  it("管理员重新抓取仍沿用原规则，新提交使用新规则", async () => {
    const first = await createVideo();
    await processVideoSubmission(first.id);
    await db.videoPointRule.update({ where: { id: "default" }, data: { fixedTierPoints: 80 } });
    await prepareVideoReprocess({ videoId: first.id, actorId: adminId });
    ownerMatches = true;
    expect((await processVideoSubmission(first.id))?.points).toBe(50);
    const next = await createVideo();
    expect((await processVideoSubmission(next.id))?.points).toBe(80);
  });

  it("并发首次审核只锁定一次配置并写一条捕获审计", async () => {
    const video = await createVideo();
    const snapshots = await Promise.all(Array.from({ length: 8 }, () => captureVideoPointRule(video.id, "FIRST_AUTOMATIC_REVIEW")));
    expect(new Set(snapshots.map((row) => row.revision)).size).toBe(1);
    expect(new Set(snapshots.map((row) => row.capturedAt.toISOString())).size).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: video.id, action: "VIDEO_POINT_RULE_CAPTURED" } })).toBe(1);
    await db.videoPointRule.update({ where: { id: "default" }, data: { fixedTierPoints: 80 } });
    expect((await captureVideoPointRule(video.id, "FIRST_AUTOMATIC_REVIEW")).revision).toBe(snapshots[0].revision);
  });

  it("数据库阻止覆盖和清除快照，规则校验拒绝小数，允许随父记录清理", async () => {
    const video = await createVideo();
    const original = await captureVideoPointRule(video.id, "FIRST_AUTOMATIC_REVIEW");
    await expect(db.videoPointRuleSnapshot.update({ where: { videoId: video.id }, data: { fixedTierPoints: 80 } })).rejects.toThrow("immutable");
    await expect(db.videoPointRuleSnapshot.delete({ where: { videoId: video.id } })).rejects.toThrow("live video");
    expect(() => videoRuleRevision({ ...DEFAULT_VIDEO_POINT_RULE, fixedTierPoints: 50.5 })).toThrow("正整数");
    expect(await db.videoPointRuleSnapshot.findUnique({ where: { videoId: video.id } })).toEqual(original);
    await db.videoSubmission.delete({ where: { id: video.id } });
    expect(await db.videoPointRuleSnapshot.count({ where: { videoId: video.id } })).toBe(0);
  });

  it("申诉按锁定上限允许显式人工调整并记录公式与实发差额", async () => {
    const video = await createVideo();
    await db.videoPointRule.update({ where: { id: "default" }, data: { maximumPoints: 6000 } });
    await processVideoSubmission(video.id);
    await db.videoPointRule.update({ where: { id: "default" }, data: { maximumPoints: 100 } });
    await seedVerifiedVideoAuthor(video.id);
    const appeal = await db.videoAppeal.create({ data: { videoId: video.id, userId: memberId, reason: "人工核实原始截图", idempotencyKey: randomUUID() } });
    appealIds.push(appeal.id);
    const input = { appealId: appeal.id, action: "approve" as const, actorId: adminId, points: 5500, reason: "原始截图与平台数据核验后补正积分" };
    const result = await Promise.all([resolveVideoAppeal(input), resolveVideoAppeal(input)]);
    expect(result.every((row) => row.reviewedPoints === 5500)).toBe(true);
    expect(await db.pointLedger.count({ where: { referenceId: video.id, type: "VIDEO_REWARD" } })).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: appeal.id, action: "VIDEO_APPEAL_APPROVED" } });
    expect(audit.afterValue).toMatchObject({ calculation: { origin: "FIRST_AUTOMATIC_REVIEW", calculatedPoints: 50, awardedPoints: 5500, awardDiffersFromFormula: true, rule: { maximumPoints: 6000 } } });
    expect(audit.reason).toBe(input.reason);
  });

  it("历史无快照申诉明确记录临时采用口径，失败时快照和审计一起回滚", async () => {
    const video = await createVideo();
    await db.videoSubmission.update({ where: { id: video.id }, data: { status: "REJECTED", likes: 500 } });
    await seedVerifiedVideoAuthor(video.id);
    const appeal = await db.videoAppeal.create({ data: { videoId: video.id, userId: memberId, reason: "历史申诉", idempotencyKey: randomUUID() } });
    appealIds.push(appeal.id);
    await expect(resolveVideoAppeal({ appealId: appeal.id, action: "approve", actorId: adminId, points: 5001 })).rejects.toThrow("5000");
    expect(await db.videoPointRuleSnapshot.count({ where: { videoId: video.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: video.id, action: "VIDEO_POINT_RULE_CAPTURED" } })).toBe(0);
    expect((await db.videoAppeal.findUniqueOrThrow({ where: { id: appeal.id } })).status).toBe("PENDING");
    const result = await resolveVideoAppeal({ appealId: appeal.id, action: "approve", actorId: adminId });
    expect(result.reviewedPoints).toBe(50);
    expect((await db.videoPointRuleSnapshot.findUniqueOrThrow({ where: { videoId: video.id } })).origin).toBe("LEGACY_APPEAL");
  });

  it("迁移后不会为历史已到账记录伪造原始规则或重新入账", async () => {
    const video = await createVideo();
    await db.videoSubmission.update({ where: { id: video.id }, data: { status: "APPROVED", likes: 500, points: 35 } });
    await db.videoPointRule.update({ where: { id: "default" }, data: { fixedTierPoints: 80 } });
    expect((await creditVideoReward({ videoId: video.id, userId: memberId, points: 80 })).points).toBe(35);
    await expect(captureVideoPointRule(video.id, "FIRST_AUTOMATIC_REVIEW")).rejects.toThrow("当前视频状态");
    expect(await db.videoPointRuleSnapshot.count({ where: { videoId: video.id } })).toBe(0);
    expect(await db.pointLedger.count({ where: { referenceId: video.id } })).toBe(0);
    expect(videoRuleEvidence(null, 500, 35)).toEqual({ ruleEvidence: "UNAVAILABLE", likes: 500, awardedPoints: 35 });
  });

  it("锁定最低赞数和投稿天数，不仅锁定积分金额", async () => {
    const video = await createVideo();
    const captured = await captureVideoPointRule(video.id, "FIRST_AUTOMATIC_REVIEW");
    await db.videoPointRule.update({ where: { id: "default" }, data: { minimumLikes: 600, submissionWindowDays: 1 } });
    ownerMatches = true;
    expect((await processVideoSubmission(video.id))?.status).toBe("APPROVED");
    expect(snapshotRule(captured)).toEqual(DEFAULT_VIDEO_POINT_RULE);
    const next = await createVideo();
    expect((await processVideoSubmission(next.id))?.status).toBe("REJECTED");
  });

  it("自动入账拒绝不同于锁定公式的分值，审计保存向下取整结果", async () => {
    const video = await createVideo();
    const captured = await captureVideoPointRule(video.id, "FIRST_AUTOMATIC_REVIEW");
    await db.videoSubmission.update({ where: { id: video.id }, data: { likes: 1501 } });
    await expect(creditVideoReward({ videoId: video.id, userId: memberId, points: 751 })).rejects.toThrow("锁定规则不一致");
    expect(await db.pointLedger.count({ where: { referenceId: video.id } })).toBe(0);
    expect((await creditVideoReward({ videoId: video.id, userId: memberId, points: 750 })).points).toBe(750);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: video.id, action: "VIDEO_APPROVED" } });
    expect(audit.afterValue).toMatchObject({ points: 750, calculation: { revision: captured.revision, likes: 1501, rounding: "floor", calculatedPoints: 750, awardedPoints: 750, awardDiffersFromFormula: false } });
    expect(videoRuleRevision({ ...DEFAULT_VIDEO_POINT_RULE, maximumPoints: 6000 })).not.toBe(captured.revision);
    expect(() => snapshotRule({ ...captured, formulaVersion: "unknown" })).toThrow("快照校验失败");
    expect(() => snapshotRule({ ...captured, fixedTierPoints: 80 })).toThrow("快照校验失败");
  });

  it("确认框的计算依据过期时拒绝静默改分，刷新确认后才入账", async () => {
    const video = await createVideo();
    await processVideoSubmission(video.id);
    const captured = await db.videoPointRuleSnapshot.findUniqueOrThrow({ where: { videoId: video.id } });
    await seedVerifiedVideoAuthor(video.id);
    const appeal = await db.videoAppeal.create({ data: { videoId: video.id, userId: memberId, reason: "已核实归属", idempotencyKey: randomUUID() } });
    appealIds.push(appeal.id);
    const input = { appealId: appeal.id, action: "approve" as const, actorId: adminId, expectedRuleRevision: captured.revision, expectedCalculatedPoints: 50 };
    await db.videoSubmission.update({ where: { id: video.id }, data: { likes: 1501 } });
    await expect(resolveVideoAppeal(input)).rejects.toThrow("刷新申诉列表");
    expect((await db.videoAppeal.findUniqueOrThrow({ where: { id: appeal.id } })).status).toBe("PENDING");
    expect(await db.pointLedger.count({ where: { referenceId: video.id } })).toBe(0);
    expect((await resolveVideoAppeal({ ...input, expectedCalculatedPoints: 750 })).reviewedPoints).toBe(750);
  });

  it("等待视频去重锁期间发生重新抓取时，申诉不能覆盖处理中状态", async () => {
    const video = await createVideo();
    const rejected = await processVideoSubmission(video.id);
    await seedVerifiedVideoAuthor(video.id);
    const appeal = await db.videoAppeal.create({ data: { videoId: video.id, userId: memberId, reason: "并发申诉", idempotencyKey: randomUUID() } });
    appealIds.push(appeal.id);
    let unlock!: () => void;
    let ready!: () => void;
    const acquired = new Promise<void>((resolve) => { ready = resolve; });
    const release = new Promise<void>((resolve) => { unlock = resolve; });
    const held = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`video-photo:${rejected!.photoId}`})::bigint)`;
      ready();
      await release;
    }, { timeout: 10_000 });
    await acquired;
    const result = resolveVideoAppeal({ appealId: appeal.id, action: "approve", actorId: adminId }).then(
      (value) => ({ value, error: null }), (error: Error) => ({ value: null, error }),
    );
    try {
      await vi.waitFor(async () => {
        const [row] = await db.$queryRaw<Array<{ waiting: bigint }>>`SELECT COUNT(*) AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory' AND query LIKE '%pg_advisory_xact_lock%'`;
        expect(Number(row.waiting)).toBeGreaterThan(0);
      }, { timeout: 3_000, interval: 20 });
      expect((await prepareVideoReprocess({ videoId: video.id, actorId: adminId })).status).toBe("PROCESSING");
    } finally { unlock(); await held; }
    expect((await result).error?.message).toContain("视频状态已变化");
    expect((await db.videoSubmission.findUniqueOrThrow({ where: { id: video.id } })).status).toBe("PROCESSING");
    expect(await db.pointLedger.count({ where: { referenceId: video.id } })).toBe(0);
  });
});

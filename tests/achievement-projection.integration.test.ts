import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const queries = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  client.$on("query", (event) => { queries.push(event.query); });
  return { db: client };
});
import { db } from "@/lib/db";
import { getMemberAchievements } from "@/lib/member-achievements";
import * as achievements from "@/lib/member-achievements";
import { claimMemberAchievementRefresh, processMemberAchievementRefresh, enqueueStaleAchievementProjections } from "@/lib/member-achievement-jobs";
import { creditVideoReward } from "@/lib/points";
import { readAchievementMetrics } from "@/lib/member-achievement-metrics";
import { checkMemberAchievementProjection } from "@/lib/member-achievement-reconciliation";
import { periodBounds } from "@/lib/rankings";

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("achievement projection", () => {
  const prefix = `projection-${crypto.randomUUID()}`;
  const reference = new Date("2040-10-10T04:00:00Z");
  let userId: string;
  let videoId: string;
  beforeAll(async () => {
    const user = await db.user.create({ data: { kuaishouId: prefix, nickname: "成长读模型测试", passwordHash: "synthetic", account: { create: { balance: 0 } } } });
    userId = user.id;
    const video = await db.videoSubmission.create({ data: { userId, sourceUrl: `https://v.kuaishou.com/${prefix}`, requestUrl: "https://v.kuaishou.com/test", sourceKind: "short-link", submittedNickname: "成长读模型测试",
      status: "APPROVED", likes: 1200, views: 2200, commentCount: 4, submittedAt: reference, idempotencyKey: prefix } });
    videoId = video.id;
  });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => {
    if (userId) {
      await db.notification.deleteMany({ where: { userId } });
      await db.auditLog.deleteMany({ where: { actorId: userId } });
      await db.auditLog.deleteMany({ where: { entityId: { in: (await db.videoSubmission.findMany({ where: { userId }, select: { id: true } })).map((row) => row.id) } } });
      await db.pointLedger.deleteMany({ where: { account: { userId } } });
      await db.videoSubmission.deleteMany({ where: { userId } });
      await db.user.delete({ where: { id: userId } });
    }
    await db.$disconnect();
  });

  it("reads an uninitialized archive without creating profiles, goals or notifications", async () => {
    queries.length = 0;
    const result = await getMemberAchievements(userId, reference);
    expect(queries.filter((sql) => /^(INSERT|UPDATE|DELETE)\b/i.test(sql.trim()))).toEqual([]);
    expect(await db.memberGrowthProfile.count({ where: { userId } })).toBe(0);
    expect(await db.memberMonthlyGoal.count({ where: { userId } })).toBe(0);
    expect(await db.notification.count({ where: { userId } })).toBe(0);
    expect(result.highlights).toHaveLength(1);
    expect(result.projection).toMatchObject({ state: "pending", initialized: false });
  });

  it("claims once and commits a fenced projection with idempotent notifications", async () => {
    const claims = await Promise.all([claimMemberAchievementRefresh(userId), claimMemberAchievementRefresh(userId)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find((row) => row !== null)!;
    const results = await Promise.all([processMemberAchievementRefresh(claim, reference), processMemberAchievementRefresh(claim, reference)]);
    expect(results.map((row) => row.status).sort()).toEqual(["processed", "stale"]);
    const result = await getMemberAchievements(userId, reference);
    expect(result.profile.experience).toBe(134);
    expect(result.goal).toMatchObject({ progress: { videos: 1, engagement: 1262 }, targetVideos: 1, targetEngagement: 100, completedAt: reference });
    expect(result.projection).toMatchObject({ state: "ready", initialized: true });
    expect(result.achievements.find((row) => row.code === "FIRST_APPROVED")?.earnedAt).not.toBeNull();
    expect(await db.notification.count({ where: { userId, type: "ACHIEVEMENT" } })).toBe(2);
    queries.length = 0;
    await Promise.all([getMemberAchievements(userId, reference), getMemberAchievements(userId, reference)]);
    expect(queries.filter((sql) => /^(INSERT|UPDATE|DELETE)\b/i.test(sql.trim()))).toEqual([]);
  });

  it("rolls back refresh intent with the source transaction", async () => {
    const before = await db.memberAchievementRefresh.findUniqueOrThrow({ where: { userId } });
    await expect(db.$transaction(async (tx) => {
      await tx.videoSubmission.update({ where: { id: videoId }, data: { likes: 8000 } });
      throw new Error("abort synthetic transaction");
    })).rejects.toThrow("abort synthetic transaction");
    const after = await db.memberAchievementRefresh.findUniqueOrThrow({ where: { userId } });
    expect(after.generation).toBe(before.generation);
    expect(after.pending).toBe(false);
    expect((await db.videoSubmission.findUniqueOrThrow({ where: { id: videoId } })).likes).toBe(1200);
  });

  it("does not block source writes or lose changes committed during a rebuild", async () => {
    await db.videoSubmission.update({ where: { id: videoId }, data: { likes: 1300 } });
    const claim = (await claimMemberAchievementRefresh(userId))!;
    let enter!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const barrier = new Promise<void>((resolve) => { resume = resolve; });
    const original = achievements.reconcileMemberAchievements;
    vi.spyOn(achievements, "reconcileMemberAchievements").mockImplementationOnce(async (...args) => {
      enter();
      await barrier;
      return original(...args);
    });
    const processing = processMemberAchievementRefresh(claim, reference);
    await entered;
    try {
      await db.videoSubmission.update({ where: { id: videoId }, data: { likes: 2500 } });
    } finally { resume(); }
    expect((await processing).status).toBe("processed");
    const dirty = await db.memberAchievementRefresh.findUniqueOrThrow({ where: { userId } });
    expect(dirty.pending).toBe(true);
    expect(dirty.generation).toBeGreaterThan(dirty.appliedGeneration);
    const next = (await claimMemberAchievementRefresh(userId))!;
    expect((await processMemberAchievementRefresh(next, reference)).status).toBe("processed");
    expect((await getMemberAchievements(userId, reference)).profile.experience).toBe(147);
    expect((await db.memberAchievementRefresh.findUniqueOrThrow({ where: { userId } })).pending).toBe(false);
    expect(await db.notification.count({ where: { userId, type: "ACHIEVEMENT" } })).toBe(2);
  });

  it("reclaims an abandoned lease and fences the old owner", async () => {
    await db.videoSubmission.update({ where: { id: videoId }, data: { likes: 2600 } });
    const abandoned = (await claimMemberAchievementRefresh(userId))!;
    await db.memberAchievementRefresh.update({ where: { userId }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    const replacement = (await claimMemberAchievementRefresh(userId))!;
    expect(replacement.leaseToken).not.toBe(abandoned.leaseToken);
    expect((await processMemberAchievementRefresh(abandoned, reference)).status).toBe("stale");
    expect((await processMemberAchievementRefresh(replacement, reference)).status).toBe("processed");
  });

  it("backs off failed work, preserves the previous projection and recovers", async () => {
    await db.videoSubmission.update({ where: { id: videoId }, data: { likes: 2700 } });
    const before = await db.memberGrowthProfile.findUniqueOrThrow({ where: { userId } });
    const claim = (await claimMemberAchievementRefresh(userId))!;
    vi.spyOn(achievements, "reconcileMemberAchievements").mockRejectedValueOnce(new Error("synthetic-secret-never-persist"));
    expect(await processMemberAchievementRefresh(claim, reference)).toEqual({ status: "failed", code: "REBUILD_FAILED" });
    const failed = await db.memberAchievementRefresh.findUniqueOrThrow({ where: { userId } });
    expect(failed).toMatchObject({ pending: true, failures: 1, lastFailureCode: "REBUILD_FAILED", leaseToken: null });
    expect(failed.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(await claimMemberAchievementRefresh(userId)).toBeNull();
    expect(await db.memberGrowthProfile.findUniqueOrThrow({ where: { userId } })).toEqual(before);
    expect((await getMemberAchievements(userId, reference)).projection.delayed).toBe(true);
    await db.memberAchievementRefresh.update({ where: { userId }, data: { availableAt: new Date(Date.now() - 1000) } });
    expect((await processMemberAchievementRefresh((await claimMemberAchievementRefresh(userId))!, reference)).status).toBe("processed");
    expect((await db.memberAchievementRefresh.findUniqueOrThrow({ where: { userId } })).failures).toBe(0);
  });

  it("rolls back derived writes when its lease is replaced mid-calculation", async () => {
    await db.videoSubmission.update({ where: { id: videoId }, data: { likes: 2800 } });
    const before = await db.memberGrowthProfile.findUniqueOrThrow({ where: { userId } });
    const claim = (await claimMemberAchievementRefresh(userId))!;
    let enter!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const barrier = new Promise<void>((resolve) => { resume = resolve; });
    const original = achievements.reconcileMemberAchievements;
    vi.spyOn(achievements, "reconcileMemberAchievements").mockImplementationOnce(async (...args) => {
      enter(); await barrier; return original(...args);
    });
    const processing = processMemberAchievementRefresh(claim, reference);
    await entered;
    await db.memberAchievementRefresh.update({ where: { userId }, data: { leaseExpiresAt: new Date(Date.now() - 60_000) } });
    const replacement = (await claimMemberAchievementRefresh(userId))!;
    resume();
    expect((await processing).status).toBe("stale");
    expect(await db.memberGrowthProfile.findUniqueOrThrow({ where: { userId } })).toEqual(before);
    expect((await processMemberAchievementRefresh(replacement, reference)).status).toBe("processed");
  });

  it("rebuilds revoked video experience, badges and goal completion without altering the locked target", async () => {
    const before = await db.memberMonthlyGoal.findFirstOrThrow({ where: { userId } });
    await db.videoSubmission.update({ where: { id: videoId }, data: { status: "REVOKED" } });
    expect((await processMemberAchievementRefresh((await claimMemberAchievementRefresh(userId))!, reference)).status).toBe("processed");
    const result = await getMemberAchievements(userId, reference);
    expect(result.profile.experience).toBe(0);
    expect(result.goal).toMatchObject({ targetVideos: before.targetVideos, targetEngagement: before.targetEngagement, completedAt: null, progress: { videos: 0, engagement: 0 } });
    expect(result.achievements.find((row) => row.code === "FIRST_APPROVED")?.earnedAt).toBeNull();
    await db.videoSubmission.update({ where: { id: videoId }, data: { status: "APPROVED" } });
    expect((await processMemberAchievementRefresh((await claimMemberAchievementRefresh(userId))!, reference)).status).toBe("processed");
    expect(await db.notification.count({ where: { userId, type: "ACHIEVEMENT" } })).toBe(2);
  });

  it("commits video credit and outbox intent even when display calculation would fail", async () => {
    const video = await db.videoSubmission.create({ data: { userId, sourceUrl: `https://v.kuaishou.com/${prefix}-credit`, requestUrl: "https://v.kuaishou.com/test", sourceKind: "short-link", submittedNickname: "成长读模型测试",
      likes: 1000, submittedAt: reference, idempotencyKey: `${prefix}-credit` } });
    const spy = vi.spyOn(achievements, "reconcileMemberAchievements").mockRejectedValue(new Error("display unavailable"));
    const result = await creditVideoReward({ videoId: video.id, userId, points: 100 });
    expect(result.status).toBe("APPROVED");
    expect(spy).not.toHaveBeenCalled();
    expect((await db.pointAccount.findUniqueOrThrow({ where: { userId } })).balance).toBe(100);
    expect(await db.pointLedger.count({ where: { account: { userId }, referenceId: video.id, amount: 100 } })).toBe(1);
    expect((await db.memberAchievementRefresh.findUniqueOrThrow({ where: { userId } })).pending).toBe(true);
  });

  it("preserves pending wait age and detects display drift through a read-only check", async () => {
    const oldRequest = new Date(Date.now() - 600_000);
    await db.memberAchievementRefresh.update({ where: { userId }, data: { requestedAt: oldRequest } });
    await db.videoSubmission.update({ where: { id: videoId }, data: { likes: 2900 } });
    expect((await db.memberAchievementRefresh.findUniqueOrThrow({ where: { userId } })).requestedAt).toEqual(oldRequest);
    expect((await processMemberAchievementRefresh((await claimMemberAchievementRefresh(userId))!, reference)).status).toBe("processed");
    expect((await checkMemberAchievementProjection(userId, reference)).consistent).toBe(true);
    await db.memberGrowthProfile.update({ where: { userId }, data: { experience: 999 } });
    queries.length = 0;
    const result = await checkMemberAchievementProjection(userId, reference);
    expect(result).toMatchObject({ consistent: false, differences: ["growth-profile"] });
    expect(queries.filter((sql) => /^(INSERT|UPDATE|DELETE)\b/i.test(sql.trim()))).toEqual([]);
    await db.$queryRaw`SELECT request_member_achievement_refresh(${userId})::text`;
    expect((await processMemberAchievementRefresh((await claimMemberAchievementRefresh(userId))!, reference)).status).toBe("processed");
    expect((await checkMemberAchievementProjection(userId, reference)).consistent).toBe(true);
  });

  it("matches per-video integer rounding and Shanghai time boundaries in SQL aggregates", async () => {
    const owner = await db.user.create({ data: { kuaishouId: `${prefix}-metrics`, nickname: "指标边界测试", passwordHash: "synthetic" } });
    const monthStart = periodBounds("month", reference).start;
    const at = (value: string) => new Date(value);
    const rows = [
      { id: `${prefix}-m1`, submittedAt: at("2040-07-31T16:00:00Z"), likes: 99, views: 999, commentCount: 1 },
      { id: `${prefix}-m2`, submittedAt: at("2040-08-31T15:59:59Z"), likes: 99, views: 999, commentCount: 1 },
      { id: `${prefix}-m3`, submittedAt: at("2040-09-30T15:59:59Z"), likes: 299, views: 2999, commentCount: 3 },
      { id: `${prefix}-m4`, submittedAt: monthStart, likes: null, views: null, commentCount: null },
      { id: `${prefix}-m5`, submittedAt: reference, likes: 299, views: 2999, commentCount: 3 },
    ];
    try {
      await db.videoSubmission.createMany({ data: rows.map((row) => ({ ...row, userId: owner.id, status: "APPROVED", sourceUrl: "https://v.kuaishou.com/metrics", requestUrl: "https://v.kuaishou.com/metrics", sourceKind: "short-link", submittedNickname: "指标边界测试", idempotencyKey: row.id })) });
      const actual = await db.$transaction((tx) => readAchievementMetrics(tx, owner.id, reference));
      expect(actual.experience).toBe(rows.reduce((sum, row) => sum + achievements.calculateGrowthExperience(row), 0));
      expect(actual.targets).toEqual(achievements.calculateMonthlyGoalTargets(rows, monthStart));
      expect(actual.metrics.months).toBe(achievements.countConsecutiveActiveMonths(rows));
      expect(actual.progress).toEqual({ videos: 2, engagement: rows.filter((row) => row.submittedAt >= monthStart).reduce((sum, row) => sum + achievements.calculateGoalEngagement(row), 0) });
    } finally { await db.user.delete({ where: { id: owner.id } }); }
  });

  it("queues a new month without GET writes and preserves the previous locked goal", async () => {
    const nextMonth = new Date("2040-11-02T04:00:00Z");
    const oldGoal = await db.memberMonthlyGoal.findFirstOrThrow({ where: { userId } });
    const pending = await getMemberAchievements(userId, nextMonth);
    expect(pending.projection).toMatchObject({ state: "pending", initialized: false });
    expect(await db.memberMonthlyGoal.count({ where: { userId } })).toBe(1);
    expect(await enqueueStaleAchievementProjections(nextMonth, 1, userId)).toEqual({ enqueued: 1 });
    expect(await enqueueStaleAchievementProjections(nextMonth, 1, userId)).toEqual({ enqueued: 0 });
    expect((await processMemberAchievementRefresh((await claimMemberAchievementRefresh(userId))!, nextMonth)).status).toBe("processed");
    expect((await getMemberAchievements(userId, nextMonth)).projection.state).toBe("ready");
    expect(await db.memberMonthlyGoal.count({ where: { userId } })).toBe(2);
    expect(await db.memberMonthlyGoal.findUnique({ where: { id: oldGoal.id } })).toEqual(oldGoal);
  });

  it("queues completed challenge count changes but ignores a claim with the same qualification", async () => {
    const week = periodBounds("week", new Date("2044-02-09T04:00:00Z"));
    const before = await db.memberAchievementRefresh.findUniqueOrThrow({ where: { userId } });
    const period = await db.weeklyChallengePeriod.create({ data: {
      periodStart: week.start, periodEnd: week.end, claimEndsAt: new Date(week.end.getTime() + 86_400_000), status: "ACTIVE", model: prefix, promptVersion: "test",
      audienceSnapshot: [userId], audienceCount: 1,
      assignments: { create: { userId, type: "COMBINED", status: "COMPLETED", weeklyVideoCounts: [0, 0, 0, 1], weeklyLikeSums: [0, 0, 0, 1000], targetVideoCount: 1, targetLikes: 1000,
        rewardPoints: 100, difficultyScore: 50, title: "任务变化测试", description: "合成测试", aiReason: "合成测试" } },
    }, include: { assignments: true } });
    try {
      const completed = await db.memberAchievementRefresh.findUniqueOrThrow({ where: { userId } });
      expect(completed.generation).toBe(before.generation + BigInt(1));
      await db.weeklyChallengeAssignment.update({ where: { id: period.assignments[0].id }, data: { status: "CLAIMED" } });
      expect((await db.memberAchievementRefresh.findUniqueOrThrow({ where: { userId } })).generation).toBe(completed.generation);
      await db.weeklyChallengeAssignment.update({ where: { id: period.assignments[0].id }, data: { status: "REVERSED" } });
      expect((await db.memberAchievementRefresh.findUniqueOrThrow({ where: { userId } })).generation).toBe(completed.generation + BigInt(1));
    } finally { await db.weeklyChallengePeriod.delete({ where: { id: period.id } }); }
  });
});

import { Prisma } from "@prisma/client";
import { db } from "./db";
import { ACHIEVEMENT_CATALOG, GROWTH_LEVELS } from "./member-achievements";
import { readAchievementMetrics } from "./member-achievement-metrics";
import { periodBounds } from "./rankings";

// Explicit operator check, not part of the member GET path. It compares durable
// display state with source records without changing points, goals or badges.
export async function checkMemberAchievementProjection(userId: string, reference = new Date()) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const monthStart = periodBounds("month", reference).start;
    const [computed, profile, goal, badges, challenges, refresh] = await Promise.all([
      readAchievementMetrics(tx, userId, reference),
      tx.memberGrowthProfile.findUnique({ where: { userId } }),
      tx.memberMonthlyGoal.findUnique({ where: { userId_monthStart: { userId, monthStart } } }),
      tx.memberAchievement.findMany({ where: { userId }, select: { code: true } }),
      tx.weeklyChallengeAssignment.count({ where: { userId, status: { in: ["COMPLETED", "CLAIMED"] } } }),
      tx.memberAchievementRefresh.findUnique({ where: { userId }, select: { pending: true } }),
    ]);
    const differences: string[] = [];
    const level = [...GROWTH_LEVELS].reverse().find((item) => computed.experience >= item.minimumExperience)!.level;
    if (profile?.experience !== computed.experience || profile?.level !== level) differences.push("growth-profile");
    if (!goal?.calculatedAt || goal.progressVideos !== computed.progress.videos || goal.progressEngagement !== computed.progress.engagement) differences.push("monthly-progress");
    if (goal && Boolean(goal.completedAt) !== (computed.progress.videos >= goal.targetVideos && computed.progress.engagement >= goal.targetEngagement)) differences.push("monthly-completion");
    const metrics = { ...computed.metrics, challenges };
    const actual = new Set(badges.map((badge) => badge.code));
    for (const badge of ACHIEVEMENT_CATALOG) {
      if (actual.has(badge.code) !== (metrics[badge.kind] >= badge.threshold)) differences.push(`badge:${badge.code}`);
    }
    return { userId, pending: refresh?.pending ?? true, differences, consistent: differences.length === 0 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });
}

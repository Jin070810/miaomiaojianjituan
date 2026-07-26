import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import {
  buildRewardTiers,
  difficultyForTargets,
  MAX_PERSONAL_REWARD,
  parseRewardTiers,
  REWARD_POLICY_VERSION,
} from "./weekly-challenge-rewards";

const DAY_MS = 24 * 60 * 60 * 1000;
const weeklyValuesSchema = z.array(z.number().int().nonnegative()).length(4);

export async function upgradeWeeklyChallengePeriodToTieredRewards(input: {
  periodId: string;
  actorId: string;
  ip?: string;
  requestId?: string;
}) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "WeeklyChallengePeriod" WHERE "id" = ${input.periodId} FOR UPDATE`;
    const period = await tx.weeklyChallengePeriod.findUnique({
      where: { id: input.periodId },
      include: {
        assignments: {
          include: { user: { select: { createdAt: true } } },
          orderBy: { userId: "asc" },
        },
      },
    });
    if (!period) throw new Error("周挑战周期不存在");
    if (period.status !== "READY") throw new Error("只有待生效的周挑战周期可以升级");

    const previousWeekStart = new Date(period.periodStart.getTime() - 7 * DAY_MS);
    const recentSubmitters = await tx.videoSubmission.findMany({
      where: {
        userId: { in: period.assignments.map((assignment) => assignment.userId) },
        submittedAt: { gte: previousWeekStart, lt: period.periodStart },
        status: { not: "FAILED" },
      },
      distinct: ["userId"],
      select: { userId: true },
    });
    const eligibleUserIds = new Set(recentSubmitters.map((row) => row.userId));
    const retained = period.assignments.filter((assignment) => eligibleUserIds.has(assignment.userId));
    const removed = period.assignments.filter((assignment) => !eligibleUserIds.has(assignment.userId));
    let upgradedAssignmentCount = 0;

    for (const assignment of retained) {
      if (parseRewardTiers(assignment.rewardTiers)) continue;
      const weeklyVideoCounts = weeklyValuesSchema.parse(assignment.weeklyVideoCounts);
      const weeklyLikeSums = weeklyValuesSchema.parse(assignment.weeklyLikeSums);
      const profile = {
        baselineVideoCount: assignment.baselineVideoCount,
        baselineLikes: assignment.baselineLikes,
        bestVideoCount: Math.max(...weeklyVideoCounts),
        bestLikes: Math.max(...weeklyLikeSums),
        newMember: period.periodStart.getTime() - assignment.user.createdAt.getTime() < 14 * DAY_MS,
      };
      const rewardTiers = buildRewardTiers(profile, assignment);
      const finalTier = rewardTiers[rewardTiers.length - 1];
      await tx.weeklyChallengeAssignment.update({
        where: { id: assignment.id },
        data: {
          targetVideoCount: finalTier.targetVideoCount,
          targetLikes: finalTier.targetLikes,
          rewardPoints: finalTier.rewardPoints,
          rewardTiers: rewardTiers as Prisma.InputJsonValue,
          claimedRewardPoints: 0,
          claimedTier: -1,
          difficultyScore: difficultyForTargets(
            profile,
            finalTier.targetVideoCount,
            finalTier.targetLikes,
            assignment.type,
          ),
        },
      });
      upgradedAssignmentCount += 1;
    }

    if (removed.length > 0) {
      await tx.weeklyChallengeAssignment.deleteMany({
        where: { id: { in: removed.map((assignment) => assignment.id) } },
      });
    }
    const audienceSnapshot = retained.map((assignment) => assignment.userId);
    const alreadyUpgraded = period.rewardPolicyVersion === REWARD_POLICY_VERSION
      && upgradedAssignmentCount === 0
      && removed.length === 0
      && period.audienceCount === retained.length;
    await tx.weeklyChallengePeriod.update({
      where: { id: period.id },
      data: {
        rewardPolicyVersion: REWARD_POLICY_VERSION,
        personalRewardBudget: retained.length * MAX_PERSONAL_REWARD,
        audienceSnapshot,
        audienceCount: retained.length,
      },
    });
    if (!alreadyUpgraded) {
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "WEEKLY_CHALLENGE_PERIOD_UPGRADED_TO_TIERED_REWARDS",
          entity: "WeeklyChallengePeriod",
          entityId: period.id,
          beforeValue: {
            rewardPolicyVersion: period.rewardPolicyVersion,
            audienceCount: period.audienceCount,
            personalRewardBudget: period.personalRewardBudget,
          },
          afterValue: {
            rewardPolicyVersion: REWARD_POLICY_VERSION,
            audienceCount: retained.length,
            personalRewardBudget: retained.length * MAX_PERSONAL_REWARD,
            upgradedAssignmentCount,
            removedInactiveAssignmentCount: removed.length,
            eligibilityRule: "previous-week-non-failed-submission",
          },
          ip: input.ip,
          requestId: input.requestId,
        },
      });
    }
    return {
      periodId: period.id,
      upgraded: !alreadyUpgraded,
      rewardPolicyVersion: REWARD_POLICY_VERSION,
      audienceCount: retained.length,
      upgradedAssignmentCount,
      removedInactiveAssignmentCount: removed.length,
      personalRewardBudget: retained.length * MAX_PERSONAL_REWARD,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

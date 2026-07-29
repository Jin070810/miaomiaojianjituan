import { Prisma } from "@prisma/client";
import { db } from "./db";
import { MAX_PERSONAL_REWARD, REWARD_POLICY_VERSION } from "./weekly-challenge-rewards";
import { memberParticipantRoles } from "./member-roles";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function prepareWeeklyChallengePeriodRegeneration(input: {
  periodId: string;
  actorId: string;
  ip?: string;
  requestId?: string;
}) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "WeeklyChallengePeriod" WHERE "id" = ${input.periodId} FOR UPDATE`;
    const period = await tx.weeklyChallengePeriod.findUnique({
      where: { id: input.periodId },
      include: { assignments: { select: { userId: true } } },
    });
    if (!period) throw new Error("周挑战周期不存在");
    if (period.status !== "READY") throw new Error("只有待生效的周挑战周期可以重新生成");
    if (period.periodStart <= new Date()) throw new Error("周期已经开始，不能重新生成任务");
    if (period.rewardPolicyVersion === REWARD_POLICY_VERSION) {
      throw new Error("该周期已经使用最新两周综合任务策略");
    }

    const previousWeekStart = new Date(period.periodStart.getTime() - 7 * DAY_MS);
    const audience = await tx.user.findMany({
      where: {
        role: { in: memberParticipantRoles },
        active: true,
        createdAt: { lt: period.periodStart },
        videos: {
          some: {
            submittedAt: { gte: previousWeekStart, lt: period.periodStart },
            status: { not: "FAILED" },
          },
        },
      },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const audienceSnapshot = audience.map((member) => member.id);
    const eligibleUserIds = new Set(audienceSnapshot);
    const retainedAssignmentCount = period.assignments.filter((assignment) =>
      eligibleUserIds.has(assignment.userId)).length;
    await tx.weeklyChallengePeriod.update({
      where: { id: period.id },
      data: {
        status: "FAILED",
        failureReason: "等待按最新两周模型策略重新生成",
        generationRunId: null,
        generationStartedAt: null,
        generatedAt: null,
        personalRewardBudget: audience.length * MAX_PERSONAL_REWARD,
        audienceSnapshot,
        audienceCount: audience.length,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "WEEKLY_CHALLENGE_PERIOD_REGENERATION_REQUESTED",
        entity: "WeeklyChallengePeriod",
        entityId: period.id,
        beforeValue: {
          status: period.status,
          rewardPolicyVersion: period.rewardPolicyVersion,
          audienceCount: period.audienceCount,
          assignmentCount: period.assignments.length,
        },
        afterValue: {
          status: "FAILED",
          targetRewardPolicyVersion: REWARD_POLICY_VERSION,
          audienceCount: audience.length,
          personalRewardBudget: audience.length * MAX_PERSONAL_REWARD,
          retainedAssignmentCount,
          removedInactiveAssignmentCount: period.assignments.length - retainedAssignmentCount,
          eligibilityRule: "previous-week-non-failed-submission",
          baselineRule: "model-judged-from-two-week-metrics",
          taskRule: "combined-video-and-likes",
        },
        ip: input.ip,
        requestId: input.requestId,
      },
    });
    return {
      periodId: period.id,
      periodStart: period.periodStart,
      previousAssignmentCount: period.assignments.length,
      audienceCount: audience.length,
      retainedAssignmentCount,
      removedInactiveAssignmentCount: period.assignments.length - retainedAssignmentCount,
      personalRewardBudget: audience.length * MAX_PERSONAL_REWARD,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

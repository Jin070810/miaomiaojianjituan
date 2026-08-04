import crypto from "node:crypto";
import {
  LedgerType,
  Prisma,
  PrismaClient,
  WeeklyChallengeAssignment,
  WeeklyChallengePeriod,
} from "@prisma/client";
import { db } from "./db";
import { createNotification } from "./notifications";
import { rewardTiersForAssignment, RewardTier } from "./weekly-challenge-rewards";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;
type DatabaseClient = TransactionClient | PrismaClient;
type AssignmentWithPeriod = WeeklyChallengeAssignment & { period: WeeklyChallengePeriod };

export function shanghaiWeekBounds(value = new Date()) {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
  const localMondayUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - daysSinceMonday,
  );
  const start = new Date(localMondayUtc - SHANGHAI_OFFSET_MS);
  const end = new Date(start.getTime() + 7 * DAY_MS);
  return { start, end, claimEndsAt: new Date(end.getTime() + 3 * DAY_MS) };
}

export function nextShanghaiWeekBounds(value = new Date()) {
  const current = shanghaiWeekBounds(value);
  return {
    start: current.end,
    end: new Date(current.end.getTime() + 7 * DAY_MS),
    claimEndsAt: new Date(current.end.getTime() + 10 * DAY_MS),
  };
}

async function ensureAccount(tx: TransactionClient, userId: string) {
  return tx.pointAccount.upsert({
    where: { userId },
    create: { userId, balance: 0 },
    update: {},
  });
}

async function creditPoints(
  tx: TransactionClient,
  input: {
    userId: string;
    amount: number;
    type: LedgerType;
    referenceId: string;
    note: string;
    idempotencyKey: string;
  },
) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error("任务积分必须为正整数");
  const existing = await tx.pointLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;
  const account = await ensureAccount(tx, input.userId);
  const updated = await tx.pointAccount.update({
    where: { id: account.id },
    data: { balance: { increment: input.amount }, version: { increment: 1 } },
  });
  return tx.pointLedger.create({
    data: {
      accountId: account.id,
      amount: input.amount,
      balanceAfter: updated.balance,
      type: input.type,
      referenceId: input.referenceId,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
    },
  });
}

async function reversePoints(
  tx: TransactionClient,
  input: {
    userId: string;
    amount: number;
    type: LedgerType;
    referenceId: string;
    note: string;
    idempotencyKey: string;
  },
) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error("冲正积分必须为正整数");
  const existing = await tx.pointLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;
  const account = await ensureAccount(tx, input.userId);
  const updated = await tx.pointAccount.update({
    where: { id: account.id },
    data: { balance: { decrement: input.amount }, version: { increment: 1 } },
  });
  return tx.pointLedger.create({
    data: {
      accountId: account.id,
      amount: -input.amount,
      balanceAfter: updated.balance,
      type: input.type,
      referenceId: input.referenceId,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
    },
  });
}

export async function weeklyChallengeProgress(
  tx: DatabaseClient,
  assignment: Pick<WeeklyChallengeAssignment, "userId" | "targetVideoCount" | "targetLikes" | "type" | "rewardPoints"> & {
    rewardTiers?: Prisma.JsonValue | null;
    period: Pick<WeeklyChallengePeriod, "periodStart" | "periodEnd">;
  },
) {
  const aggregate = await tx.videoSubmission.aggregate({
    where: {
      userId: assignment.userId,
      status: "APPROVED",
      submittedAt: { gte: assignment.period.periodStart, lt: assignment.period.periodEnd },
    },
    _count: { id: true },
    _sum: { likes: true },
  });
  const videoCount = aggregate._count.id;
  const likes = aggregate._sum.likes ?? 0;
  const rewardTiers = rewardTiersForAssignment(assignment);
  const tierMet = (tier: RewardTier) => {
    const videoTargetMet = tier.targetVideoCount !== null && videoCount >= tier.targetVideoCount;
    const likesTargetMet = tier.targetLikes !== null && likes >= tier.targetLikes;
    return assignment.type === "VIDEO_COUNT"
      ? videoTargetMet
      : assignment.type === "LIKE_SUM"
        ? likesTargetMet
        : videoTargetMet && likesTargetMet;
  };
  let reachedTierIndex = -1;
  for (let index = 0; index < rewardTiers.length; index += 1) {
    if (!tierMet(rewardTiers[index])) break;
    reachedTierIndex = index;
  }
  const claimedRewardPoints = "claimedRewardPoints" in assignment && typeof assignment.claimedRewardPoints === "number"
    ? assignment.claimedRewardPoints
    : 0;
  const claimedTier = "claimedTier" in assignment && typeof assignment.claimedTier === "number"
    ? assignment.claimedTier
    : -1;
  const reachedRewardPoints = reachedTierIndex >= 0 ? rewardTiers[reachedTierIndex].rewardPoints : 0;
  const claimableRewardPoints = Math.max(0, reachedRewardPoints - claimedRewardPoints);
  return {
    videoCount,
    likes,
    qualified: reachedTierIndex === rewardTiers.length - 1,
    reachedTierIndex,
    claimedTier,
    claimedRewardPoints,
    claimableRewardPoints,
    rewardTiers,
    nextTier: rewardTiers[reachedTierIndex + 1] ?? null,
  };
}

async function weeklyRewardsEnabled(tx: DatabaseClient) {
  const setting = await tx.systemSetting.findUnique({
    where: { key: "WEEKLY_CHALLENGES" },
    select: { enabled: true },
  });
  return setting?.enabled ?? false;
}

async function awardRaceWinner(
  tx: TransactionClient,
  assignment: AssignmentWithPeriod,
  completedAt: Date,
) {
  if (completedAt >= assignment.period.periodEnd || !(await weeklyRewardsEnabled(tx))) return null;
  await tx.$queryRaw`SELECT "id" FROM "WeeklyChallengePeriod" WHERE "id" = ${assignment.period.id} FOR UPDATE`;
  const existing = await tx.weeklyRaceWinner.findUnique({ where: { periodId: assignment.period.id } });
  if (existing && !existing.reversedAt) return existing;
  const winner = existing
    ? await tx.weeklyRaceWinner.update({
        where: { id: existing.id },
        data: {
          assignmentId: assignment.id,
          userId: assignment.userId,
          rewardPoints: assignment.period.raceReward,
          wonAt: completedAt,
          reversedAt: null,
        },
      })
    : await tx.weeklyRaceWinner.create({
        data: {
          periodId: assignment.period.id,
          assignmentId: assignment.id,
          userId: assignment.userId,
          rewardPoints: assignment.period.raceReward,
          wonAt: completedAt,
        },
      });
  const ledger = await creditPoints(tx, {
    userId: assignment.userId,
    amount: assignment.period.raceReward,
    type: "WEEKLY_RACE_REWARD",
    referenceId: winner.id,
    note: "每周个性化挑战竞速冠军",
    idempotencyKey: `weekly-race:${assignment.period.id}:reward:${assignment.id}`,
  });
  await tx.auditLog.create({
    data: {
      action: "WEEKLY_RACE_WON",
      entity: "WeeklyRaceWinner",
      entityId: winner.id,
      afterValue: {
        periodId: assignment.period.id,
        assignmentId: assignment.id,
        points: assignment.period.raceReward,
        balanceAfter: ledger.balanceAfter,
      },
    },
  });
  await createNotification(tx, {
    userId: assignment.userId,
    type: "WEEKLY_CHALLENGE",
    title: "本周竞速挑战第一名",
    body: `你最先完成了本周个性化挑战，${assignment.period.raceReward} 积分已到账`,
    entityType: "WeeklyChallengeAssignment",
    entityId: assignment.id,
    metadata: { amount: assignment.period.raceReward, raceWinner: true },
    dedupeKey: `weekly-race:${assignment.period.id}:winner:${assignment.id}`,
  });
  return winner;
}

export async function evaluateWeeklyChallengeAfterVideoApproval(
  tx: TransactionClient,
  input: { userId: string; submittedAt: Date; completedAt?: Date },
) {
  const completedAt = input.completedAt ?? new Date();
  const assignment = await tx.weeklyChallengeAssignment.findFirst({
    where: {
      userId: input.userId,
      status: "ACTIVE",
      period: {
        status: "ACTIVE",
        periodStart: { lte: input.submittedAt },
        periodEnd: { gt: input.submittedAt },
      },
    },
    include: { period: true },
  });
  if (!assignment) return null;
  const progress = await weeklyChallengeProgress(tx, assignment);
  if (progress.reachedTierIndex < 0) return { assignment, progress, completed: false };
  const finalTierReached = progress.qualified;
  if (!finalTierReached) {
    if (assignment.reversedAt) {
      await tx.weeklyChallengeAssignment.updateMany({
        where: { id: assignment.id, status: "ACTIVE" },
        data: { reversedAt: null },
      });
    }
    await createNotification(tx, {
      userId: input.userId,
      type: "WEEKLY_CHALLENGE",
      title: `周挑战${progress.rewardTiers[progress.reachedTierIndex].label}已解锁`,
      body: `你已达到阶段目标，可领取 ${progress.rewardTiers[progress.reachedTierIndex].rewardPoints} 分累计奖励`,
      entityType: "WeeklyChallengeAssignment",
      entityId: assignment.id,
      metadata: {
        tierIndex: progress.reachedTierIndex,
        rewardPoints: progress.rewardTiers[progress.reachedTierIndex].rewardPoints,
        claimableRewardPoints: progress.claimableRewardPoints,
      },
      dedupeKey: `weekly-challenge:${assignment.id}:tier:${progress.reachedTierIndex}`,
    });
    return { assignment, progress, completed: false };
  }
  const claimed = await tx.weeklyChallengeAssignment.updateMany({
    where: { id: assignment.id, status: "ACTIVE" },
    data: { status: "COMPLETED", completedAt, reversedAt: null },
  });
  if (claimed.count !== 1) return { assignment, progress, completed: false };
  const completed = await tx.weeklyChallengeAssignment.findUniqueOrThrow({
    where: { id: assignment.id },
    include: { period: true },
  });
  await tx.auditLog.create({
    data: {
      action: "WEEKLY_CHALLENGE_COMPLETED",
      entity: "WeeklyChallengeAssignment",
      entityId: assignment.id,
      afterValue: { progress, completedAt },
    },
  });
  await createNotification(tx, {
      userId: input.userId,
      type: "WEEKLY_CHALLENGE",
      title: "本周个性化挑战已达标",
      body: `你已完成“${assignment.title}”，最高可领取 ${assignment.rewardPoints} 积分`,
      entityType: "WeeklyChallengeAssignment",
      entityId: assignment.id,
      metadata: { rewardPoints: assignment.rewardPoints, claimable: true, tierIndex: progress.reachedTierIndex },
      dedupeKey: `weekly-challenge:${assignment.id}:completed`,
    });
  const raceWinner = await awardRaceWinner(tx, completed, completedAt);
  return { assignment: completed, progress, completed: true, raceWinner };
}

export async function claimWeeklyChallenge(input: {
  assignmentId: string;
  userId: string;
  idempotencyKey: string;
  ip?: string;
}) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        if (!(await weeklyRewardsEnabled(tx))) throw new Error("周挑战积分发放当前暂停，请稍后再试");
        const assignment = await tx.weeklyChallengeAssignment.findUnique({
          where: { id: input.assignmentId },
          include: { period: true },
        });
        if (!assignment || assignment.userId !== input.userId) throw new Error("周挑战任务不存在");
        const replayAudit = await tx.auditLog.findFirst({
          where: {
            action: "WEEKLY_CHALLENGE_CLAIMED",
            entity: "WeeklyChallengeAssignment",
            entityId: assignment.id,
            requestId: input.idempotencyKey,
          },
          orderBy: { createdAt: "desc" },
        });
        if (replayAudit) {
          const after = replayAudit.afterValue && typeof replayAudit.afterValue === "object" && !Array.isArray(replayAudit.afterValue)
            ? replayAudit.afterValue as Record<string, unknown>
            : {};
          const tierIndex = typeof after.tierIndex === "number" ? after.tierIndex : assignment.claimedTier;
          const ledger = await tx.pointLedger.findUnique({
            where: { idempotencyKey: `weekly-challenge:${assignment.id}:reward:${tierIndex}` },
          });
          return { assignment, ledger };
        }
        if (assignment.status === "CLAIMED") throw new Error("该任务的最高阶段奖励已领取");
        if (assignment.status === "REVERSED" || assignment.status === "EXPIRED") throw new Error("该任务已失效");
        if (new Date() >= assignment.period.claimEndsAt) throw new Error("该任务领奖时间已结束");
        const progress = await weeklyChallengeProgress(tx, assignment);
        if (progress.claimableRewardPoints <= 0 || progress.reachedTierIndex < 0) {
          throw new Error("当前没有可领取的阶段奖励");
        }
        const tierIndex = progress.reachedTierIndex;
        const tier = progress.rewardTiers[tierIndex];
        const delta = progress.claimableRewardPoints;
        const claimedAt = new Date();
        const claimed = await tx.weeklyChallengeAssignment.updateMany({
          where: {
            id: assignment.id,
            status: { in: ["ACTIVE", "COMPLETED"] },
            claimedRewardPoints: assignment.claimedRewardPoints,
            claimedTier: assignment.claimedTier,
          },
          data: {
            status: progress.qualified ? "CLAIMED" : "ACTIVE",
            completedAt: progress.qualified ? (assignment.completedAt ?? claimedAt) : assignment.completedAt,
            claimedAt: progress.qualified ? claimedAt : assignment.claimedAt,
            claimIdempotencyKey: input.idempotencyKey,
            claimedRewardPoints: tier.rewardPoints,
            claimedTier: tierIndex,
          },
        });
        if (claimed.count !== 1) throw new Error("任务状态已变化，请刷新后重试");
        const ledger = await creditPoints(tx, {
          userId: input.userId,
          amount: delta,
          type: "WEEKLY_CHALLENGE_REWARD",
          referenceId: assignment.id,
          note: `每周个性化挑战：${assignment.title}（${tier.label}）`,
          idempotencyKey: `weekly-challenge:${assignment.id}:reward:${tierIndex}`,
        });
        await tx.auditLog.create({
          data: {
            actorId: input.userId,
            action: "WEEKLY_CHALLENGE_CLAIMED",
            entity: "WeeklyChallengeAssignment",
            entityId: assignment.id,
            beforeValue: {
              status: assignment.status,
              claimedTier: assignment.claimedTier,
              claimedRewardPoints: assignment.claimedRewardPoints,
            },
            afterValue: {
              status: progress.qualified ? "CLAIMED" : "ACTIVE",
              tierIndex,
              tierRewardPoints: tier.rewardPoints,
              amount: delta,
              balanceAfter: ledger.balanceAfter,
            },
            ip: input.ip,
            requestId: input.idempotencyKey,
          },
        });
        await createNotification(tx, {
          userId: input.userId,
          type: "WEEKLY_CHALLENGE",
          title: `${tier.label}已领取`,
          body: `${delta} 积分已到账，累计已领取 ${tier.rewardPoints} 分，当前余额 ${ledger.balanceAfter} 分`,
          entityType: "WeeklyChallengeAssignment",
          entityId: assignment.id,
          metadata: { amount: delta, tierIndex, cumulativeRewardPoints: tier.rewardPoints, balanceAfter: ledger.balanceAfter },
          dedupeKey: `weekly-challenge:${assignment.id}:claimed:${tierIndex}`,
        });
        return {
          assignment: await tx.weeklyChallengeAssignment.findUniqueOrThrow({ where: { id: assignment.id } }),
          ledger,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new Error("该幂等请求标识已用于其他周挑战");
      }
      if (!retryable || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 25));
    }
  }
  throw new Error("周挑战领奖事务重试失败");
}

async function reassignRaceWinner(tx: TransactionClient, periodId: string, invalidAssignmentId: string) {
  await tx.$queryRaw`SELECT "id" FROM "WeeklyChallengePeriod" WHERE "id" = ${periodId} FOR UPDATE`;
  const winner = await tx.weeklyRaceWinner.findUnique({
    where: { periodId },
    include: { period: true },
  });
  if (!winner || winner.assignmentId !== invalidAssignmentId || winner.reversedAt) return;
  await reversePoints(tx, {
    userId: winner.userId,
    amount: winner.rewardPoints,
    type: "WEEKLY_RACE_REVERSAL",
    referenceId: winner.id,
    note: "竞速冠军任务因视频撤销失效",
    idempotencyKey: `weekly-race:${periodId}:reversal:${winner.assignmentId}`,
  });
  await tx.weeklyRaceWinner.update({ where: { id: winner.id }, data: { reversedAt: new Date() } });
  const candidates = await tx.weeklyChallengeAssignment.findMany({
    where: {
      periodId,
      id: { not: invalidAssignmentId },
      completedAt: { not: null, lt: winner.period.periodEnd },
      status: { in: ["COMPLETED", "CLAIMED"] },
    },
    include: { period: true },
    orderBy: [{ completedAt: "asc" }, { id: "asc" }],
  });
  for (const candidate of candidates) {
    const progress = await weeklyChallengeProgress(tx, candidate);
    if (!progress.qualified) continue;
    await awardRaceWinner(tx, candidate, candidate.completedAt ?? new Date());
    break;
  }
}

export async function reconcileWeeklyChallengesAfterVideoRevocation(
  tx: TransactionClient,
  input: { userId: string; submittedAt: Date; videoId: string; reason: string },
) {
  const assignments = await tx.weeklyChallengeAssignment.findMany({
    where: {
      userId: input.userId,
      status: { in: ["ACTIVE", "COMPLETED", "CLAIMED"] },
      period: {
        periodStart: { lte: input.submittedAt },
        periodEnd: { gt: input.submittedAt },
      },
    },
    include: { period: true },
  });
  for (const assignment of assignments) {
    const progress = await weeklyChallengeProgress(tx, assignment);
    const tiered = assignment.rewardTiers !== null;
    if (!tiered) {
      if (progress.qualified || !["COMPLETED", "CLAIMED"].includes(assignment.status)) continue;
      if (assignment.status === "CLAIMED") {
        await reversePoints(tx, {
          userId: assignment.userId,
          amount: assignment.rewardPoints,
          type: "WEEKLY_CHALLENGE_REVERSAL",
          referenceId: assignment.id,
          note: `周挑战证据视频已撤销：${input.reason}`,
          idempotencyKey: `weekly-challenge:${assignment.id}:reversal`,
        });
      }
      await tx.weeklyChallengeAssignment.update({
        where: { id: assignment.id },
        data: {
          status: "REVERSED",
          reversedAt: new Date(),
          claimedRewardPoints: 0,
          claimedTier: -1,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "WEEKLY_CHALLENGE_REVERSED",
          entity: "WeeklyChallengeAssignment",
          entityId: assignment.id,
          beforeValue: { status: assignment.status },
          afterValue: { status: "REVERSED", progress, videoId: input.videoId },
          reason: input.reason,
        },
      });
      await createNotification(tx, {
        userId: assignment.userId,
        type: "WEEKLY_CHALLENGE",
        title: "周挑战资格已撤销",
        body: `用于达标的视频被撤销，任务奖励${assignment.status === "CLAIMED" ? "已同步扣回" : "已失效"}`,
        entityType: "WeeklyChallengeAssignment",
        entityId: assignment.id,
        metadata: { amount: assignment.status === "CLAIMED" ? -assignment.rewardPoints : 0, status: "REVERSED" },
        dedupeKey: `weekly-challenge:${assignment.id}:reversed`,
      });
      await reassignRaceWinner(tx, assignment.periodId, assignment.id);
      continue;
    }

    const eligibleReward = progress.reachedTierIndex >= 0
      ? progress.rewardTiers[progress.reachedTierIndex].rewardPoints
      : 0;
    const reversalAmount = Math.max(0, assignment.claimedRewardPoints - eligibleReward);
    const finalTierLost = !progress.qualified && ["COMPLETED", "CLAIMED"].includes(assignment.status);
    if (reversalAmount === 0 && !finalTierLost) continue;
    if (reversalAmount > 0) {
      await reversePoints(tx, {
        userId: assignment.userId,
        amount: reversalAmount,
        type: "WEEKLY_CHALLENGE_REVERSAL",
        referenceId: assignment.id,
        note: `周挑战证据视频已撤销：${input.reason}`,
        idempotencyKey: `weekly-challenge:${assignment.id}:reversal:${input.videoId}:to:${progress.reachedTierIndex}`,
      });
    }
    const newClaimedRewardPoints = Math.min(assignment.claimedRewardPoints, eligibleReward);
    const newClaimedTier = newClaimedRewardPoints === 0
      ? -1
      : Math.min(assignment.claimedTier, progress.reachedTierIndex);
    const newStatus = progress.qualified
      ? (newClaimedTier === progress.rewardTiers.length - 1 ? "CLAIMED" : "COMPLETED")
      : "ACTIVE";
    await tx.weeklyChallengeAssignment.update({
      where: { id: assignment.id },
      data: {
        status: newStatus,
        completedAt: progress.qualified ? assignment.completedAt : null,
        claimedAt: newStatus === "CLAIMED" ? assignment.claimedAt : null,
        claimIdempotencyKey: newStatus === "CLAIMED" ? assignment.claimIdempotencyKey : null,
        claimedRewardPoints: newClaimedRewardPoints,
        claimedTier: newClaimedTier,
        reversedAt: reversalAmount > 0 ? new Date() : assignment.reversedAt,
      },
    });
    await tx.auditLog.create({
      data: {
        action: "WEEKLY_CHALLENGE_TIER_DOWNGRADED",
        entity: "WeeklyChallengeAssignment",
        entityId: assignment.id,
        beforeValue: {
          status: assignment.status,
          claimedTier: assignment.claimedTier,
          claimedRewardPoints: assignment.claimedRewardPoints,
        },
        afterValue: {
          status: newStatus,
          reachedTierIndex: progress.reachedTierIndex,
          claimedTier: newClaimedTier,
          claimedRewardPoints: newClaimedRewardPoints,
          reversalAmount,
          videoId: input.videoId,
        },
        reason: input.reason,
      },
    });
    await createNotification(tx, {
      userId: assignment.userId,
      type: "WEEKLY_CHALLENGE",
      title: "周挑战阶段已调整",
      body: reversalAmount > 0
        ? `用于达标的视频被撤销，已扣回不再满足的 ${reversalAmount} 积分，仍满足的阶段奖励予以保留`
        : "用于达标的视频被撤销，冲刺阶段需要重新完成",
      entityType: "WeeklyChallengeAssignment",
      entityId: assignment.id,
      metadata: {
        amount: -reversalAmount,
        status: newStatus,
        reachedTierIndex: progress.reachedTierIndex,
        claimedRewardPoints: newClaimedRewardPoints,
      },
      dedupeKey: `weekly-challenge:${assignment.id}:downgraded:${input.videoId}:${progress.reachedTierIndex}`,
    });
    if (finalTierLost) await reassignRaceWinner(tx, assignment.periodId, assignment.id);
  }
}

export async function activateAndCloseWeeklyChallenges(now = new Date()) {
  return db.$transaction(async (tx) => {
    const enabled = await weeklyRewardsEnabled(tx);
    const ready = enabled
      ? await tx.weeklyChallengePeriod.findMany({
          where: { status: "READY", periodStart: { lte: now }, periodEnd: { gt: now } },
          include: { assignments: true },
        })
      : [];
    let activated = 0;
    for (const period of ready) {
      const changed = await tx.weeklyChallengePeriod.updateMany({
        where: { id: period.id, status: "READY" },
        data: { status: "ACTIVE", activatedAt: now },
      });
      if (changed.count !== 1) continue;
      activated += 1;
      await tx.auditLog.create({
        data: {
          action: "WEEKLY_CHALLENGE_PERIOD_ACTIVATED",
          entity: "WeeklyChallengePeriod",
          entityId: period.id,
          beforeValue: { status: "READY" },
          afterValue: { status: "ACTIVE", activatedAt: now },
        },
      });
      for (const assignment of period.assignments) {
        await createNotification(tx, {
          userId: assignment.userId,
          type: "WEEKLY_CHALLENGE",
          title: "本周个性化挑战已发布",
          body: `${assignment.title}，分阶段累计最高可领取 ${assignment.rewardPoints} 积分`,
          entityType: "WeeklyChallengeAssignment",
          entityId: assignment.id,
          metadata: { rewardPoints: assignment.rewardPoints, targetVideoCount: assignment.targetVideoCount, targetLikes: assignment.targetLikes },
          dedupeKey: `weekly-challenge:${assignment.id}:activated`,
        });
      }
    }
    const missedPeriods = await tx.weeklyChallengePeriod.findMany({
      where: { status: "READY", periodEnd: { lte: now } },
      select: { id: true },
    });
    let cancelled = 0;
    let cancelledAssignments = 0;
    for (const period of missedPeriods) {
      const changed = await tx.weeklyChallengePeriod.updateMany({
        where: { id: period.id, status: "READY" },
        data: {
          status: "CANCELLED",
          closedAt: now,
          failureReason: "周期结束前未激活，任务未发布",
        },
      });
      if (changed.count !== 1) continue;
      cancelled += 1;
      const expiredForPeriod = (await tx.weeklyChallengeAssignment.updateMany({
        where: { periodId: period.id, status: "ACTIVE" },
        data: { status: "EXPIRED" },
      })).count;
      cancelledAssignments += expiredForPeriod;
      await tx.auditLog.create({
        data: {
          action: "WEEKLY_CHALLENGE_PERIOD_CANCELLED",
          entity: "WeeklyChallengePeriod",
          entityId: period.id,
          beforeValue: { status: "READY" },
          afterValue: {
            status: "CANCELLED",
            closedAt: now,
            expiredAssignments: expiredForPeriod,
          },
          reason: "周期结束前未激活，任务未发布",
        },
      });
    }
    const closed = await tx.weeklyChallengePeriod.updateMany({
      where: { status: "ACTIVE", periodEnd: { lte: now } },
      data: { status: "CLOSED", closedAt: now },
    });
    const expired = await tx.weeklyChallengeAssignment.updateMany({
      where: {
        status: { in: ["ACTIVE", "COMPLETED"] },
        period: { claimEndsAt: { lte: now } },
      },
      data: { status: "EXPIRED" },
    });
    return {
      activated,
      cancelled,
      cancelledAssignments,
      closed: closed.count,
      expired: expired.count,
    };
  });
}

export async function getCurrentWeeklyChallenge(userId: string, now = new Date()) {
  const assignment = await db.weeklyChallengeAssignment.findFirst({
    where: {
      userId,
      period: {
        status: { in: ["ACTIVE", "CLOSED"] },
        periodStart: { lte: now },
        claimEndsAt: { gt: now },
      },
    },
    include: { period: { include: { raceWinner: { select: { wonAt: true } } } } },
    orderBy: { period: { periodStart: "desc" } },
  });
  if (!assignment) return null;
  const [progress, rewardsEnabled] = await Promise.all([
    weeklyChallengeProgress(db, assignment),
    weeklyRewardsEnabled(db),
  ]);
  return {
    ...assignment,
    progress,
    rewardsEnabled,
    claimable: rewardsEnabled
      && progress.claimableRewardPoints > 0
      && ["ACTIVE", "COMPLETED"].includes(assignment.status)
      && now < assignment.period.claimEndsAt,
    raceEnded: Boolean(assignment.period.raceWinner) || now >= assignment.period.periodEnd,
  };
}

export async function weeklyChallengeSchedulerStatus(now = new Date()) {
  const currentBounds = shanghaiWeekBounds(now);
  const [latest, current, enabled] = await Promise.all([
    db.weeklyChallengePeriod.findFirst({
      orderBy: { periodStart: "desc" },
      select: {
        periodStart: true,
        periodEnd: true,
        status: true,
        generationMode: true,
        fallbackBatchCount: true,
        generationWarning: true,
        generatedAt: true,
        activatedAt: true,
        failureReason: true,
        _count: { select: { assignments: true, attempts: true } },
      },
    }),
    db.weeklyChallengePeriod.findUnique({
      where: { periodStart: currentBounds.start },
      select: {
        periodStart: true,
        periodEnd: true,
        status: true,
        generationMode: true,
        fallbackBatchCount: true,
        generationWarning: true,
        generatedAt: true,
        activatedAt: true,
        failureReason: true,
        _count: { select: { assignments: true, attempts: true } },
      },
    }),
    weeklyRewardsEnabled(db),
  ]);
  const operationalIssues = enabled
    ? [
        ...(!current ? ["当前周挑战周期缺失"] : []),
        ...(current && ["FAILED", "CANCELLED"].includes(current.status)
          ? [`当前周挑战周期状态异常：${current.status}`] : []),
        ...(current && current.fallbackBatchCount > 0
          ? [`当前周挑战有 ${current.fallbackBatchCount} 个批次使用确定性降级`] : []),
      ]
    : [];
  return {
    enabled,
    providerConfigured: Boolean(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_BASE_URL && process.env.DEEPSEEK_MODEL),
    latest,
    current,
    degraded: operationalIssues.length > 0,
    operationalIssues,
  };
}

export function opaqueMemberRef(periodStart: Date, userId: string) {
  return crypto.createHash("sha256").update(`${periodStart.toISOString()}:${userId}`).digest("hex").slice(0, 20);
}

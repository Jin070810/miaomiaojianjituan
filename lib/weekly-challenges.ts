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
  assignment: Pick<WeeklyChallengeAssignment, "userId" | "targetVideoCount" | "targetLikes" | "type"> & {
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
  const videoTargetMet = assignment.targetVideoCount === null || videoCount >= assignment.targetVideoCount;
  const likesTargetMet = assignment.targetLikes === null || likes >= assignment.targetLikes;
  const qualified = assignment.type === "VIDEO_COUNT"
    ? assignment.targetVideoCount !== null && videoTargetMet
    : assignment.type === "LIKE_SUM"
      ? assignment.targetLikes !== null && likesTargetMet
      : assignment.targetVideoCount !== null && assignment.targetLikes !== null && videoTargetMet && likesTargetMet;
  return { videoCount, likes, qualified };
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
  if (!progress.qualified) return { assignment, progress, completed: false };
  const claimed = await tx.weeklyChallengeAssignment.updateMany({
    where: { id: assignment.id, status: "ACTIVE" },
    data: { status: "COMPLETED", completedAt },
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
    body: `你已完成“${assignment.title}”，可领取 ${assignment.rewardPoints} 积分`,
    entityType: "WeeklyChallengeAssignment",
    entityId: assignment.id,
    metadata: { rewardPoints: assignment.rewardPoints, claimable: true },
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
        const replay = await tx.weeklyChallengeAssignment.findUnique({
          where: { claimIdempotencyKey: input.idempotencyKey },
          include: { period: true },
        });
        if (replay) {
          if (replay.id !== input.assignmentId || replay.userId !== input.userId) {
            throw new Error("该幂等请求标识已用于其他周挑战");
          }
          const ledger = await tx.pointLedger.findFirst({
            where: { referenceId: replay.id, type: "WEEKLY_CHALLENGE_REWARD" },
          });
          return { assignment: replay, ledger };
        }
        const assignment = await tx.weeklyChallengeAssignment.findUnique({
          where: { id: input.assignmentId },
          include: { period: true },
        });
        if (!assignment || assignment.userId !== input.userId) throw new Error("周挑战任务不存在");
        if (assignment.status === "CLAIMED") {
          const ledger = await tx.pointLedger.findFirst({
            where: { referenceId: assignment.id, type: "WEEKLY_CHALLENGE_REWARD" },
          });
          return { assignment, ledger };
        }
        if (assignment.status === "REVERSED" || assignment.status === "EXPIRED") throw new Error("该任务已失效");
        if (new Date() >= assignment.period.claimEndsAt) throw new Error("该任务领奖时间已结束");
        const progress = await weeklyChallengeProgress(tx, assignment);
        if (!progress.qualified) throw new Error("任务尚未达标");
        const claimedAt = new Date();
        const claimed = await tx.weeklyChallengeAssignment.updateMany({
          where: { id: assignment.id, status: { in: ["ACTIVE", "COMPLETED"] } },
          data: {
            status: "CLAIMED",
            completedAt: assignment.completedAt ?? claimedAt,
            claimedAt,
            claimIdempotencyKey: input.idempotencyKey,
          },
        });
        if (claimed.count !== 1) throw new Error("任务状态已变化，请刷新后重试");
        const ledger = await creditPoints(tx, {
          userId: input.userId,
          amount: assignment.rewardPoints,
          type: "WEEKLY_CHALLENGE_REWARD",
          referenceId: assignment.id,
          note: `每周个性化挑战：${assignment.title}`,
          idempotencyKey: `weekly-challenge:${assignment.id}:reward`,
        });
        await tx.auditLog.create({
          data: {
            actorId: input.userId,
            action: "WEEKLY_CHALLENGE_CLAIMED",
            entity: "WeeklyChallengeAssignment",
            entityId: assignment.id,
            beforeValue: { status: assignment.status },
            afterValue: { status: "CLAIMED", rewardPoints: assignment.rewardPoints, balanceAfter: ledger.balanceAfter },
            ip: input.ip,
            requestId: input.idempotencyKey,
          },
        });
        await createNotification(tx, {
          userId: input.userId,
          type: "WEEKLY_CHALLENGE",
          title: "周挑战奖励已领取",
          body: `${assignment.rewardPoints} 积分已到账，当前余额 ${ledger.balanceAfter} 分`,
          entityType: "WeeklyChallengeAssignment",
          entityId: assignment.id,
          metadata: { amount: assignment.rewardPoints, balanceAfter: ledger.balanceAfter },
          dedupeKey: `weekly-challenge:${assignment.id}:claimed`,
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
      status: { in: ["COMPLETED", "CLAIMED"] },
      period: {
        periodStart: { lte: input.submittedAt },
        periodEnd: { gt: input.submittedAt },
      },
    },
    include: { period: true },
  });
  for (const assignment of assignments) {
    const progress = await weeklyChallengeProgress(tx, assignment);
    if (progress.qualified) continue;
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
      data: { status: "REVERSED", reversedAt: new Date() },
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
          body: `${assignment.title}，完成后可领取 ${assignment.rewardPoints} 积分`,
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
    claimable: rewardsEnabled && progress.qualified && ["ACTIVE", "COMPLETED"].includes(assignment.status) && now < assignment.period.claimEndsAt,
    raceEnded: Boolean(assignment.period.raceWinner) || now >= assignment.period.periodEnd,
  };
}

export async function weeklyChallengeSchedulerStatus() {
  const latest = await db.weeklyChallengePeriod.findFirst({
    orderBy: { periodStart: "desc" },
    select: {
      periodStart: true,
      periodEnd: true,
      status: true,
      generatedAt: true,
      activatedAt: true,
      failureReason: true,
      _count: { select: { assignments: true, attempts: true } },
    },
  });
  return {
    enabled: await weeklyRewardsEnabled(db),
    providerConfigured: Boolean(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_BASE_URL && process.env.DEEPSEEK_MODEL),
    latest,
  };
}

export function opaqueMemberRef(periodStart: Date, userId: string) {
  return crypto.createHash("sha256").update(`${periodStart.toISOString()}:${userId}`).digest("hex").slice(0, 20);
}

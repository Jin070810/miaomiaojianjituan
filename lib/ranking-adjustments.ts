import { Prisma } from "@prisma/client";
import { db } from "./db";
import { createNotification } from "./notifications";

export class RankingAdjustmentError extends Error {}

export const openRankingFreeze = { kind: "FREEZE_UNPAID", status: "PENDING" } as const;

export async function lockRankingAward(tx: Prisma.TransactionClient, awardId: string) {
  await tx.$queryRaw`SELECT "id" FROM "RankingAward" WHERE "id" = ${awardId} FOR UPDATE`;
}

export async function assertRankingAwardNotFrozen(tx: Prisma.TransactionClient, awardId: string) {
  if (await tx.rankingAwardAdjustment.findFirst({ where: { awardId, ...openRankingFreeze }, select: { id: true } })) {
    throw new RankingAdjustmentError("榜单奖励已冻结，需先完成审计调整");
  }
}

// The caller holds the ranking period advisory locks, before changing the video.
// Every award writer takes its row lock before inspecting holds or stock.
export async function protectRankingsAfterVideoRevocation(tx: Prisma.TransactionClient, input: {
  video: { id: string; userId: string; submittedAt: Date; likes: number | null; points: number };
  actorId: string;
  reason: string;
  ip?: string;
}) {
  const { video } = input;
  const awards = await tx.rankingAward.findMany({
    where: { userId: video.userId, period: { status: "SETTLED", periodStart: { lte: video.submittedAt }, periodEnd: { gt: video.submittedAt } } },
    select: { id: true, periodId: true }, orderBy: { id: "asc" },
  });
  for (const candidate of awards) {
    await lockRankingAward(tx, candidate.id);
    const award = await tx.rankingAward.findUniqueOrThrow({ where: { id: candidate.id }, include: { period: true } });
    if (award.status === "EXPIRED") continue;
    const contribution = await tx.rankingContribution.findUnique({ where: { periodId_videoId: { periodId: award.periodId, videoId: video.id } } });
    if (award.period.contributionsCapturedAt && !contribution) continue;
    const existing = await tx.rankingAwardAdjustment.findUnique({ where: { awardId_videoId: { awardId: award.id, videoId: video.id } } });
    if (existing) continue;
    const kind = award.status === "FULFILLED" ? "REVIEW_PAID" : "FREEZE_UNPAID";
    const adjustment = await tx.rankingAwardAdjustment.create({ data: {
      awardId: award.id, videoId: video.id, kind,
      source: contribution ? "SNAPSHOT" : "LEGACY_WINDOW",
      videoSnapshot: { videoId: video.id, userId: video.userId, submittedAt: video.submittedAt.toISOString(), likesAtSettlement: contribution?.likes ?? null, likesAtRevocation: video.likes, pointsAtRevocation: video.points },
      awardSnapshot: { periodId: award.periodId, rank: award.rank, value: award.value, status: award.status, rewardTitle: award.rewardTitle, rewardDescription: award.rewardDescription, giftId: award.giftId, fulfilledAt: award.fulfilledAt?.toISOString() ?? null },
      reason: input.reason, createdById: input.actorId,
    } });
    await tx.auditLog.create({ data: {
      actorId: input.actorId, action: kind === "FREEZE_UNPAID" ? "RANKING_AWARD_FROZEN" : "RANKING_AWARD_ADJUSTMENT_OPENED", entity: "RankingAwardAdjustment", entityId: adjustment.id,
      beforeValue: { awardId: award.id, status: award.status, rank: award.rank, value: award.value },
      afterValue: { awardId: award.id, videoId: video.id, kind, source: adjustment.source, historyPreserved: true }, reason: input.reason, ip: input.ip,
    } });
    await createNotification(tx, {
      userId: award.userId, type: "RANKING_AWARD", title: kind === "FREEZE_UNPAID" ? "榜单奖励暂缓发放" : "榜单奖励进入调整核实",
      body: kind === "FREEZE_UNPAID" ? "一条相关视频已撤销，历史名次保留，奖励暂时冻结。管理员核实后会通知处理结果。" : "一条相关视频已撤销，历史名次和已发奖励记录保留，管理员将核实是否需要调整。",
      entityType: "RankingAward", entityId: award.id, metadata: { adjustmentId: adjustment.id, kind }, dedupeKey: `ranking-adjustment:${adjustment.id}:opened`,
    });
  }
}

export type RankingAdjustmentResolution = "RELEASE" | "CANCEL" | "ADJUSTED" | "NO_CHANGE";

export async function resolveRankingAdjustment(input: { id: string; actorId: string; resolution: RankingAdjustmentResolution; note: string; ip?: string }) {
  const note = input.note.trim();
  if (note.length < 5 || note.length > 1000) throw new RankingAdjustmentError("处理依据需填写 5 至 1000 字");
  return db.$transaction(async (tx) => {
    const candidate = await tx.rankingAwardAdjustment.findUnique({ where: { id: input.id } });
    if (!candidate) throw new RankingAdjustmentError("榜单调整待办不存在");
    await lockRankingAward(tx, candidate.awardId);
    const task = await tx.rankingAwardAdjustment.findUniqueOrThrow({ where: { id: input.id } });
    if (task.status === "RESOLVED") {
      if (task.resolution !== input.resolution || task.resolutionNote !== note || task.resolvedById !== input.actorId) throw new RankingAdjustmentError("待办已由其他处理结果关闭，请刷新后核对");
      return task;
    }
    const award = await tx.rankingAward.findUniqueOrThrow({ where: { id: task.awardId } });
    if (task.kind === "FREEZE_UNPAID" && !["RELEASE", "CANCEL"].includes(input.resolution)) throw new RankingAdjustmentError("冻结奖励只能解除冻结或取消奖励");
    if (task.kind === "REVIEW_PAID" && !["ADJUSTED", "NO_CHANGE"].includes(input.resolution)) throw new RankingAdjustmentError("已发奖励需记录调整结果或无需调整依据");
    if (task.kind === "FREEZE_UNPAID" && input.resolution === "RELEASE" && !["PENDING", "CLAIMED"].includes(award.status)) throw new RankingAdjustmentError("当前奖励不能恢复领取或发放");
    const tasks = input.resolution === "CANCEL"
      ? await tx.rankingAwardAdjustment.findMany({ where: { awardId: award.id, ...openRankingFreeze }, orderBy: { id: "asc" } }) : [task];
    const resolvedAt = new Date();
    for (const item of tasks) {
      await tx.rankingAwardAdjustment.update({ where: { id: item.id }, data: { status: "RESOLVED", resolution: input.resolution, resolutionNote: note, resolvedById: input.actorId, resolvedAt } });
      await tx.auditLog.create({ data: { actorId: input.actorId, action: "RANKING_AWARD_ADJUSTMENT_RESOLVED", entity: "RankingAwardAdjustment", entityId: item.id,
        beforeValue: { status: item.status, kind: item.kind, awardId: award.id }, afterValue: { status: "RESOLVED", resolution: input.resolution, awardId: award.id, videoId: item.videoId }, reason: note, ip: input.ip } });
    }
    if (input.resolution === "CANCEL" && award.status !== "EXPIRED") {
      if (!["PENDING", "CLAIMED"].includes(award.status)) throw new RankingAdjustmentError("已发放奖励不能按未发奖励取消");
      await tx.rankingAward.update({ where: { id: award.id }, data: { status: "EXPIRED", fulfilledAt: null } });
      if (award.giftId) await tx.gift.update({ where: { id: award.giftId }, data: { stock: { increment: 1 } } });
      await tx.auditLog.create({ data: { actorId: input.actorId, action: "RANKING_AWARD_CANCELLED", entity: "RankingAward", entityId: award.id,
        beforeValue: { status: award.status, giftId: award.giftId }, afterValue: { status: "EXPIRED", stockRestored: Boolean(award.giftId), adjustmentIds: tasks.map((item) => item.id) }, reason: note, ip: input.ip } });
    }
    const stillFrozen = await tx.rankingAwardAdjustment.count({ where: { awardId: award.id, ...openRankingFreeze } });
    await createNotification(tx, { userId: award.userId, type: "RANKING_AWARD", title: "榜单奖励核实结果已更新",
      body: input.resolution === "CANCEL" ? "本期奖励已取消，历史榜单名次保留。" : input.resolution === "RELEASE" ? stillFrozen ? "一项冻结已解除，其他待核实项尚未完成，奖励继续暂缓发放。" : "相关冻结已解除，可继续领取或等待发放。" : "已发奖励的调整核实已完成，历史记录保留。如需了解详情，请联系管理员。",
      entityType: "RankingAward", entityId: award.id, metadata: { adjustmentId: task.id, resolution: input.resolution }, dedupeKey: `ranking-adjustment:${task.id}:resolved` });
    return tx.rankingAwardAdjustment.findUniqueOrThrow({ where: { id: task.id } });
  });
}

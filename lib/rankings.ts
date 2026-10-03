import { RankingPeriodType, Prisma } from "@prisma/client";
import { db } from "./db";
import { decryptSensitive, encryptSensitive } from "./security";
import { createNotification } from "./notifications";
import { memberParticipantRoles } from "./member-roles";

import { lockRankingPeriod, periodBounds, type RankingKind } from "./ranking-period";
import { assertRankingAwardNotFrozen, lockRankingAward } from "./ranking-adjustments";
export { periodBounds, type RankingKind } from "./ranking-period";

function periodType(kind: Exclude<RankingKind, "total">): RankingPeriodType {
  return kind === "week" ? "WEEK" : "MONTH";
}

async function ensurePeriod(
  tx: Prisma.TransactionClient | typeof db,
  kind: Exclude<RankingKind, "total">,
  reference = new Date(),
) {
  const bounds = periodBounds(kind, reference);
  return tx.rankingPeriod.upsert({
    where: { type_periodStart: { type: periodType(kind), periodStart: bounds.start } },
    create: { type: periodType(kind), periodStart: bounds.start, periodEnd: bounds.end },
    update: {},
  });
}

type ComputedRow = { userId: string; value: number; videoCount: number; likes: number };

async function computeRows(tx: Prisma.TransactionClient | typeof db, kind: RankingKind, start?: Date, end?: Date) {
  if (kind === "total") {
    const rows = await tx.pointAccount.findMany({
      where: { user: { active: true, role: { in: memberParticipantRoles } } },
      select: { userId: true, balance: true },
      orderBy: [{ balance: "desc" }, { userId: "asc" }],
      take: 100,
    });
    return rows.map((row) => ({ userId: row.userId, value: row.balance, videoCount: 0, likes: 0 }));
  }
  if (!start || !end) throw new Error("榜单周期缺失");
  const grouped = await tx.videoSubmission.groupBy({
    by: ["userId"],
    where: {
      status: "APPROVED",
      submittedAt: { gte: start, lt: end },
      user: { active: true, role: { in: memberParticipantRoles } },
    },
    _count: { id: true },
    _sum: { likes: true },
  });
  const rows = grouped.map((row) => {
    const videoCount = row._count.id;
    const likes = row._sum.likes ?? 0;
    return { userId: row.userId, value: kind === "week" ? videoCount : likes, videoCount, likes };
  });
  return rows
    .sort((a, b) => b.value - a.value || b.videoCount - a.videoCount || b.likes - a.likes || a.userId.localeCompare(b.userId))
    .slice(0, 100);
}

async function userMap(tx: Prisma.TransactionClient | typeof db, ids: string[]) {
  const users = await tx.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, kuaishouId: true, nickname: true, avatarUrl: true },
  });
  return new Map(users.map((user) => [user.id, user]));
}

export async function getLiveRanking(kind: RankingKind, userId?: string, reference = new Date()) {
  const period = kind === "total" ? null : await ensurePeriod(db, kind, reference);
  const rows = period?.status === "SETTLED"
    ? await db.rankingEntry.findMany({ where: { periodId: period.id }, orderBy: { rank: "asc" } })
    : await computeRows(db, kind, period?.periodStart, period?.periodEnd);
  const byId = await userMap(db, rows.map((row) => row.userId));
  return {
    kind,
    period: period ? { id: period.id, start: period.periodStart, end: period.periodEnd, status: period.status } : null,
    rankings: rows.map((row, index) => ({
      rank: "rank" in row ? row.rank : index + 1,
      userId: row.userId,
      kuaishouId: byId.get(row.userId)?.kuaishouId ?? "",
      nickname: byId.get(row.userId)?.nickname ?? "未知成员",
      avatarUrl: byId.get(row.userId)?.avatarUrl ?? null,
      value: row.value,
      videoCount: row.videoCount,
      likes: row.likes,
      current: row.userId === userId,
    })),
  };
}

export type RankingRewardInput = { rank: number; title: string; description?: string };

export async function previewRankingPeriod(input: { type: Exclude<RankingKind, "total">; periodStart: Date }) {
  const period = await db.rankingPeriod.findUnique({
    where: { type_periodStart: { type: periodType(input.type), periodStart: input.periodStart } },
  });
  if (!period) return { period: null, rankings: [] };
  const rows = period.status === "SETTLED"
    ? await db.rankingEntry.findMany({ where: { periodId: period.id }, orderBy: { rank: "asc" } })
    : await computeRows(db, input.type, period.periodStart, period.periodEnd);
  const users = await userMap(db, rows.slice(0, 5).map((row) => row.userId));
  return {
    period,
    rankings: rows.slice(0, 5).map((row, index) => ({
      rank: "rank" in row ? row.rank : index + 1,
      userId: row.userId,
      nickname: users.get(row.userId)?.nickname ?? "未知成员",
      kuaishouId: users.get(row.userId)?.kuaishouId ?? "",
      value: row.value,
      videoCount: row.videoCount,
      likes: row.likes,
    })),
  };
}

export async function listSettlementPeriods(reference = new Date()) {
  for (const kind of ["week", "month"] as const) {
    const current = periodBounds(kind, reference);
    await ensurePeriod(db, kind, reference);
    await ensurePeriod(db, kind, periodBounds(kind, new Date(current.start.getTime() - 1)).start);
  }
  return db.rankingPeriod.findMany({
    where: { status: "OPEN", periodEnd: { lte: reference } },
    orderBy: [{ periodEnd: "desc" }, { type: "asc" }],
    take: 120,
  });
}

export async function settleRankingPeriod(input: {
  type: Exclude<RankingKind, "total">;
  periodStart: Date;
  rewards: RankingRewardInput[];
  actorId: string;
  ip?: string;
  settledAt?: Date;
  allowEmptyRewards?: boolean;
}) {
  const settledAt = input.settledAt ?? new Date();
  const expected = periodBounds(input.type, input.periodStart);
  if (expected.start.getTime() !== input.periodStart.getTime()) throw new Error("榜单周期起点不符合 Asia/Shanghai 边界");
  const period = await db.rankingPeriod.findUnique({
    where: { type_periodStart: { type: periodType(input.type), periodStart: input.periodStart } },
  });
  if (!period) throw new Error("榜单周期不存在");
  if (period.periodEnd > settledAt) throw new Error("当前周期尚未结束，不能结算");
  const rewardMap = new Map(input.rewards.map((reward) => [reward.rank, reward]));
  return db.$transaction(async (tx) => {
    await lockRankingPeriod(tx, input.type, input.periodStart);
    const ruleSnapshot = { version: "ranking-v1", timezone: "Asia/Shanghai", timeBasis: "submittedAt", metric: input.type === "week" ? "videoCount" : "likes", rankingLimit: 100, awardLimit: 5, eligibleRoles: memberParticipantRoles, tieBreakers: ["value desc", "videoCount desc", "likes desc", "userId localeCompare asc"], rewards: input.rewards };
    const capturedAt = new Date();
    const claimed = await tx.rankingPeriod.updateMany({
      where: { id: period.id, status: "OPEN", periodEnd: { lte: settledAt } },
      data: { status: "SETTLED", settledAt, ruleSnapshot, contributionsCapturedAt: capturedAt },
    });
    if (claimed.count !== 1) {
      const current = await tx.rankingPeriod.findUniqueOrThrow({ where: { id: period.id } });
      return { period: current, settled: false, reason: "已结算" };
    }
    // One INSERT...SELECT fixes the contributing set at a single DB snapshot.
    // Aggregation reads that set, never a second view of mutable submissions.
    await tx.$executeRaw`
      INSERT INTO "RankingContribution" ("periodId", "videoId", "userId", "likes", "submittedAt")
      SELECT ${period.id}, v."id", v."userId", COALESCE(v."likes", 0), v."submittedAt"
      FROM "VideoSubmission" v JOIN "User" u ON u."id" = v."userId"
      WHERE v."status" = 'APPROVED'
        AND v."submittedAt" >= (${period.periodStart}::timestamptz AT TIME ZONE 'UTC')
        AND v."submittedAt" < (${period.periodEnd}::timestamptz AT TIME ZONE 'UTC')
        AND u."active" = true AND u."role"::text IN (${Prisma.join(memberParticipantRoles)})`;
    const grouped = await tx.rankingContribution.groupBy({ by: ["userId"], where: { periodId: period.id }, _count: { videoId: true }, _sum: { likes: true } });
    const rows = grouped.map((row) => ({ userId: row.userId, value: input.type === "week" ? row._count.videoId : row._sum.likes ?? 0, videoCount: row._count.videoId, likes: row._sum.likes ?? 0 }))
      .sort((a, b) => b.value - a.value || b.videoCount - a.videoCount || b.likes - a.likes || a.userId.localeCompare(b.userId)).slice(0, 100);
    if (!input.allowEmptyRewards && rows.some((_, index) => index < 5 && !rewardMap.get(index + 1)?.title.trim())) {
      throw new Error("前五名实际获奖成员必须填写奖励名称");
    }
    const entries = [];
    const awards = [];
    for (const [index, row] of rows.entries()) {
      const rank = index + 1;
      const entry = await tx.rankingEntry.create({
        data: { periodId: period.id, userId: row.userId, rank, value: row.value, videoCount: row.videoCount, likes: row.likes },
      });
      entries.push(entry);
      if (rank <= 5) {
        const reward = rewardMap.get(rank);
        const award = await tx.rankingAward.create({
          data: {
            periodId: period.id,
            userId: row.userId,
            rank,
            value: row.value,
            rewardTitle: reward?.title?.trim() || null,
            rewardDescription: reward?.description?.trim() || null,
          },
        });
        awards.push(award);
      }
    }
    const members = await tx.user.findMany({ where: { active: true, role: { in: memberParticipantRoles } }, select: { id: true } });
    const winnerByUser = new Map(awards.map((award) => [award.userId, award]));
    for (const member of members) {
      const award = winnerByUser.get(member.id);
      if (award) {
        await createNotification(tx, {
          userId: member.id,
          type: "RANKING_AWARD",
          title: `${input.type === "week" ? "周榜" : "月榜"}结算完成：第 ${award.rank} 名`,
          body: `本期成绩 ${award.value}，奖励：${award.rewardTitle ?? "待公布"}${award.rewardDescription ? `。${award.rewardDescription}` : ""}。请填写收货信息领取奖励。`,
          entityType: "RankingAward",
          entityId: award.id,
          metadata: { rank: award.rank, value: award.value, rewardTitle: award.rewardTitle, action: "CLAIM_SHIPPING" },
          dedupeKey: `ranking:${period.id}:${member.id}`,
        });
      } else {
        await createNotification(tx, {
          userId: member.id,
          type: "RANKING_RESULT",
          title: `${input.type === "week" ? "周榜" : "月榜"}已结算`,
          body: rows.length ? `本期榜单已完成结算，共有 ${rows.length} 名成员上榜。` : "本期暂无有效成绩。",
          entityType: "RankingPeriod",
          entityId: period.id,
          metadata: { type: input.type, hasResults: rows.length > 0 },
          dedupeKey: `ranking:${period.id}:${member.id}`,
        });
      }
    }
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "RANKING_SETTLED",
        entity: "RankingPeriod",
        entityId: period.id,
        afterValue: { kind: input.type, periodStart: period.periodStart.toISOString(), periodEnd: period.periodEnd.toISOString(), topFive: rows.slice(0, 5), rewards: input.rewards, ruleSnapshot, contributionsCapturedAt: capturedAt.toISOString() },
        ip: input.ip,
      },
    });
    return { period: { ...period, status: "SETTLED" as const, settledAt, ruleSnapshot, contributionsCapturedAt: capturedAt }, settled: true, entries, awards };
  });
}

export async function settleRanking(kind: Exclude<RankingKind, "total">, periodReference = new Date(), settledAt = new Date()) {
  const period = await ensurePeriod(db, kind, periodReference);
  if (period.periodEnd > settledAt) return { period, settled: false, reason: "周期尚未结束" };
  return settleRankingPeriod({
    type: kind,
    periodStart: period.periodStart,
    rewards: [],
    actorId: "system",
    settledAt,
    allowEmptyRewards: true,
  });
}

export async function claimRankingAward(input: {
  awardId: string;
  userId: string;
  recipientName?: string;
  phone?: string;
  address?: string;
  ip?: string;
}) {
  return db.$transaction(async (tx) => {
    await lockRankingAward(tx, input.awardId);
    const award = await tx.rankingAward.findUnique({ where: { id: input.awardId }, include: { gift: true, period: true } });
    if (!award || award.userId !== input.userId) throw new Error("领奖记录不存在");
    await assertRankingAwardNotFrozen(tx, award.id);
    if (award.status === "CLAIMED" || award.status === "FULFILLED") return award;
    if (award.status === "EXPIRED") throw new Error("该榜单奖励已过期");
    const profile = await tx.recipientProfile.findUnique({ where: { userId: input.userId } });
    const recipientName = input.recipientName?.trim() || profile?.recipientName || null;
    const phone = input.phone?.trim() || (profile?.phoneEnc ? decryptSensitive(profile.phoneEnc) : null);
    const address = input.address?.trim() || (profile?.addressEnc ? decryptSensitive(profile.addressEnc) : null);
    if (!recipientName || !phone || !address) throw new Error("领奖需要完整的收货姓名、手机号和详细地址");
    const claimed = await tx.rankingAward.updateMany({
      where: { id: award.id, status: "PENDING" },
      data: {
        status: "CLAIMED",
        recipientName,
        recipientPhoneEnc: phone ? encryptSensitive(phone) : null,
        recipientAddressEnc: address ? encryptSensitive(address) : null,
        claimedAt: new Date(),
      },
    });
    if (claimed.count !== 1) return tx.rankingAward.findUniqueOrThrow({ where: { id: award.id }, include: { gift: true, period: true } });
    await tx.recipientProfile.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        recipientName,
        phoneEnc: phone ? encryptSensitive(phone) : null,
        addressEnc: address ? encryptSensitive(address) : null,
      },
      update: {
        recipientName,
        phoneEnc: phone ? encryptSensitive(phone) : null,
        addressEnc: address ? encryptSensitive(address) : null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.userId,
        action: "RANKING_AWARD_CLAIMED",
        entity: "RankingAward",
        entityId: award.id,
        afterValue: { rank: award.rank, giftId: award.giftId, hasRecipient: true },
        ip: input.ip,
      },
    });
    return tx.rankingAward.findUniqueOrThrow({ where: { id: award.id }, include: { gift: true, period: true } });
  });
}

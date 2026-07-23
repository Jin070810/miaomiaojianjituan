import { RankingPeriodType, Prisma } from "@prisma/client";
import { db } from "./db";
import { decryptSensitive, encryptSensitive } from "./security";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type RankingKind = "week" | "month" | "total";

function localParts(value: Date) {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay(),
  };
}

function shanghaiDate(year: number, month: number, date: number) {
  return new Date(Date.UTC(year, month, date) - SHANGHAI_OFFSET_MS);
}

export function periodBounds(kind: Exclude<RankingKind, "total">, reference = new Date()) {
  const parts = localParts(reference);
  if (kind === "month") {
    const start = shanghaiDate(parts.year, parts.month, 1);
    return { start, end: shanghaiDate(parts.year, parts.month + 1, 1) };
  }
  const mondayOffset = (parts.day + 6) % 7;
  const start = shanghaiDate(parts.year, parts.month, parts.date - mondayOffset);
  return { start, end: new Date(start.getTime() + WEEK_MS) };
}

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
    update: { periodEnd: bounds.end },
  });
}

type ComputedRow = { userId: string; value: number; videoCount: number; likes: number };

async function computeRows(tx: Prisma.TransactionClient | typeof db, kind: RankingKind, start?: Date, end?: Date) {
  if (kind === "total") {
    const rows = await tx.pointAccount.findMany({
      where: { user: { active: true } },
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
      user: { active: true },
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
    select: { id: true, kuaishouId: true, nickname: true },
  });
  return new Map(users.map((user) => [user.id, user]));
}

export async function getLiveRanking(kind: RankingKind, userId?: string, reference = new Date()) {
  const period = kind === "total" ? null : await ensurePeriod(db, kind, reference);
  const rows = await computeRows(db, kind, period?.periodStart, period?.periodEnd);
  const byId = await userMap(db, rows.map((row) => row.userId));
  return {
    kind,
    period: period ? { id: period.id, start: period.periodStart, end: period.periodEnd, status: period.status } : null,
    rankings: rows.map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      kuaishouId: byId.get(row.userId)?.kuaishouId ?? "",
      nickname: byId.get(row.userId)?.nickname ?? "未知成员",
      value: row.value,
      videoCount: row.videoCount,
      likes: row.likes,
      current: row.userId === userId,
    })),
  };
}

export async function settleRanking(kind: Exclude<RankingKind, "total">, periodReference = new Date(), settledAt = new Date()) {
  const period = await ensurePeriod(db, kind, periodReference);
  if (period.periodEnd > settledAt) return { period, settled: false, reason: "周期尚未结束" };
  return db.$transaction(async (tx) => {
    const claimed = await tx.rankingPeriod.updateMany({
      where: { id: period.id, status: "OPEN" },
      data: { status: "SETTLED", settledAt },
    });
    if (claimed.count !== 1) {
      return { period: await tx.rankingPeriod.findUniqueOrThrow({ where: { id: period.id } }), settled: false, reason: "已结算" };
    }
    const rows = await computeRows(tx, kind, period.periodStart, period.periodEnd);
    for (const [index, row] of rows.entries()) {
      const rank = index + 1;
      await tx.rankingEntry.create({
        data: { periodId: period.id, userId: row.userId, rank, value: row.value, videoCount: row.videoCount, likes: row.likes },
      });
      if (rank <= 5) {
        await tx.rankingAward.create({
          data: { periodId: period.id, userId: row.userId, rank, value: row.value },
        });
      }
    }
    await tx.auditLog.create({
      data: {
        action: "RANKING_SETTLED",
        entity: "RankingPeriod",
        entityId: period.id,
        afterValue: { kind, periodStart: period.periodStart.toISOString(), periodEnd: period.periodEnd.toISOString(), topFive: rows.slice(0, 5) },
      },
    });
    return { period: { ...period, status: "SETTLED" as const, settledAt }, settled: true };
  });
}

export async function settleDueRankings(reference = new Date()) {
  const results = [];
  for (const kind of ["week", "month"] as const) {
    const current = periodBounds(kind, reference);
    const latest = await db.rankingPeriod.findFirst({
      where: { type: periodType(kind), status: "SETTLED" },
      orderBy: { periodStart: "desc" },
    });
    let cursor = latest?.periodEnd ?? periodBounds(kind, new Date(current.start.getTime() - 1)).start;
    let safety = 0;
    while (cursor < current.start && safety < 120) {
      results.push(await settleRanking(kind, cursor, reference));
      cursor = periodBounds(kind, cursor).end;
      safety += 1;
    }
  }
  return results;
}

export async function claimRankingAward(input: {
  awardId: string;
  userId: string;
  recipientName?: string;
  phone?: string;
  address?: string;
  cashQrCodeUrl?: string;
  ip?: string;
}) {
  return db.$transaction(async (tx) => {
    const award = await tx.rankingAward.findUnique({ where: { id: input.awardId }, include: { gift: true, period: true } });
    if (!award || award.userId !== input.userId) throw new Error("领奖记录不存在");
    if (award.status === "CLAIMED" || award.status === "FULFILLED") return award;
    if (!award.gift) throw new Error("奖励礼品尚未配置，请联系管理员");
    const profile = await tx.recipientProfile.findUnique({ where: { userId: input.userId } });
    const recipientName = input.recipientName?.trim() || profile?.recipientName || null;
    const phone = input.phone?.trim() || (profile?.phoneEnc ? decryptSensitive(profile.phoneEnc) : null);
    const address = input.address?.trim() || (profile?.addressEnc ? decryptSensitive(profile.addressEnc) : null);
    const cashQrCodeUrl = input.cashQrCodeUrl?.trim() || profile?.cashQrCodeUrl || null;
    if (award.gift.kind === "CASH" && !cashQrCodeUrl) throw new Error("现金奖励必须提供收款码");
    if (award.gift.kind === "PHYSICAL" && (!recipientName || !phone || !address)) {
      throw new Error("领奖需要完整的收货姓名、手机号和详细地址");
    }
    const claimed = await tx.rankingAward.updateMany({
      where: { id: award.id, status: "PENDING" },
      data: {
        status: "CLAIMED",
        recipientName,
        recipientPhoneEnc: phone ? encryptSensitive(phone) : null,
        recipientAddressEnc: address ? encryptSensitive(address) : null,
        cashQrCodeUrl,
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
        cashQrCodeUrl,
      },
      update: {
        recipientName,
        phoneEnc: phone ? encryptSensitive(phone) : null,
        addressEnc: address ? encryptSensitive(address) : null,
        cashQrCodeUrl,
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

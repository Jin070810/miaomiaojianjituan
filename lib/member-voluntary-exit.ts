import { Prisma } from "@prisma/client";
import { db } from "./db";
import { isMemberParticipantRole } from "./member-roles";
import { writeAuditLog } from "./audit";

export const VOLUNTARY_EXIT_REASONS = [
  "对剪辑团目前的待遇不满意",
  "因学业等原因没有时间继续剪辑",
  "不喜欢妙妙了",
  "其他原因",
] as const;

export type VoluntaryExitReason = (typeof VOLUNTARY_EXIT_REASONS)[number];

const cancellableOrderStatuses = ["PENDING", "APPROVED"] as const;
const activeVideoStatuses = ["PROCESSING", "PENDING_REVIEW", "FAILED"] as const;

function isVoluntaryExitReason(value: string): value is VoluntaryExitReason {
  return (VOLUNTARY_EXIT_REASONS as readonly string[]).includes(value);
}

function jsonNumber(value: Prisma.JsonValue | null, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
}

export async function listVoluntaryMemberExits(input: { skip: number; take: number; search?: string }) {
  const search = input.search?.trim();
  const where: Prisma.AuditLogWhereInput = {
    action: "MEMBER_VOLUNTARILY_LEFT",
    ...(search ? {
      actor: {
        is: {
          OR: [
            { kuaishouId: { contains: search, mode: "insensitive" } },
            { nickname: { contains: search, mode: "insensitive" } },
          ],
        },
      },
    } : {}),
  };
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      select: {
        id: true,
        entityId: true,
        reason: true,
        beforeValue: true,
        afterValue: true,
        createdAt: true,
        actor: { select: { id: true, nickname: true, kuaishouId: true, active: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: input.skip,
      take: input.take,
    }),
    db.auditLog.count({ where }),
  ]);
  return {
    exits: rows.map((row) => ({
      id: row.id,
      userId: row.entityId,
      reason: row.reason,
      exitedAt: row.createdAt,
      forfeitedPoints: jsonNumber(row.beforeValue, "balance"),
      clearedOrders: jsonNumber(row.beforeValue, "orderCount"),
      restoredStockOrders: jsonNumber(row.afterValue, "restoredStockOrderCount"),
      member: row.actor,
    })),
    total,
  };
}

export async function voluntarilyExitMember(input: {
  userId: string;
  reason: string;
  ip?: string | null;
  requestId?: string | null;
}) {
  if (!isVoluntaryExitReason(input.reason)) throw new Error("请选择有效的退团原因");

  return db.$transaction(async (tx) => {
    // Keep the member lock first so an in-flight video approval cannot award points after exit.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true, active: true, role: true, guildStatus: true },
    });
    if (!user) throw new Error("成员不存在");
    if (!isMemberParticipantRole(user.role)) throw new Error("当前账号不能主动退团");
    if (!user.active) return { alreadyExited: true, clearedOrders: 0, forfeitedPoints: 0 };

    await tx.$queryRaw`SELECT "id" FROM "PointAccount" WHERE "userId" = ${input.userId} FOR UPDATE`;
    const account = await tx.pointAccount.findUnique({ where: { userId: input.userId } });
    const beforeBalance = account?.balance ?? 0;
    const orders = await tx.redemptionOrder.findMany({
      where: { userId: input.userId },
      select: { id: true, giftId: true, quantity: true, totalCost: true, status: true },
      orderBy: [{ giftId: "asc" }, { id: "asc" }],
    });

    // PENDING/APPROVED orders have reserved stock. Return it before deleting every order.
    const reservedByGift = new Map<string, number>();
    for (const order of orders) {
      if (!(cancellableOrderStatuses as readonly string[]).includes(order.status)) continue;
      reservedByGift.set(order.giftId, (reservedByGift.get(order.giftId) ?? 0) + order.quantity);
    }
    for (const [giftId, quantity] of [...reservedByGift.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      await tx.gift.update({ where: { id: giftId }, data: { stock: { increment: quantity } } });
    }

    let forfeitedPoints = 0;
    if (account && beforeBalance > 0) {
      forfeitedPoints = beforeBalance;
      await tx.pointAccount.update({
        where: { id: account.id },
        data: { balance: 0, version: { increment: 1 } },
      });
      await tx.pointLedger.create({
        data: {
          accountId: account.id,
          type: "MEMBER_VOLUNTARY_EXIT_FORFEIT",
          amount: -beforeBalance,
          balanceAfter: 0,
          referenceId: input.userId,
          note: "成员主动退团：积分清零",
          idempotencyKey: `voluntary-exit-forfeit:${input.userId}`,
        },
      });
    }

    const now = new Date();
    const pendingSecondaryReviews = await tx.videoSecondaryReview.findMany({
      where: { video: { userId: input.userId }, status: "PENDING" },
      select: { id: true, videoId: true, reviewerId: true, status: true },
    });
    for (const review of pendingSecondaryReviews) {
      const updated = await tx.videoSecondaryReview.update({
        where: { id: review.id },
        data: { status: "REJECTED", reviewReason: "成员主动退团，审核终止", reviewedAt: now },
      });
      await writeAuditLog(tx, {
        actorId: input.userId,
        action: "VIDEO_SECONDARY_REJECTED",
        entity: "VideoSecondaryReview",
        entityId: review.id,
        beforeValue: { status: review.status, videoId: review.videoId, reviewerId: review.reviewerId },
        afterValue: { status: updated.status, videoId: updated.videoId, reviewerId: updated.reviewerId },
        reason: "成员主动退团，审核终止",
        ip: input.ip,
        requestId: input.requestId,
      });
    }
    await tx.redemptionOrder.deleteMany({ where: { userId: input.userId } });
    await tx.videoSubmission.updateMany({
      where: { userId: input.userId, status: { in: [...activeVideoStatuses] } },
      data: {
        status: "REJECTED",
        points: 0,
        reviewReason: "成员主动退团，未完成的视频不再处理",
        processedAt: now,
        reviewedAt: now,
      },
    });
    await tx.user.update({
      where: { id: input.userId },
      data: { active: false, guildStatus: "已退团" },
    });
    await tx.guildStatusHistory.create({
      data: { userId: input.userId, status: "已退团", reason: input.reason },
    });
    await tx.session.deleteMany({ where: { userId: input.userId } });
    await tx.memberEligibility.updateMany({
      where: { userId: input.userId },
      // clearedAt is reserved for automatic inactivity clearance history.
      data: { status: "EXEMPT", cooldownEndsAt: null, rejoinRetryAt: null },
    });
    await writeAuditLog(tx, {
      actorId: input.userId,
      action: "MEMBER_VOLUNTARILY_LEFT",
      entity: "User",
      entityId: input.userId,
      beforeValue: {
        active: true,
        guildStatus: user.guildStatus,
        balance: beforeBalance,
        orderCount: orders.length,
        orderTotalCost: orders.reduce((total, order) => total + order.totalCost, 0),
      },
      afterValue: {
        active: false,
        guildStatus: "已退团",
        balance: 0,
        ordersCleared: orders.length,
        restoredStockOrderCount: orders.filter((order) => (cancellableOrderStatuses as readonly string[]).includes(order.status)).length,
      },
      reason: input.reason,
      ip: input.ip,
      requestId: input.requestId,
    });

    return {
      alreadyExited: false,
      clearedOrders: orders.length,
      forfeitedPoints,
    };
  });
}

export const memberVoluntaryExitInternals = { isVoluntaryExitReason };

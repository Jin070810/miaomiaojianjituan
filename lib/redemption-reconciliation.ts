import { Prisma, RedemptionStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { db } from "./db";
import { createNotification } from "./notifications";
import { ensureAccount } from "./points";

const ACTIVE_REDEMPTION_STATUSES: RedemptionStatus[] = [
  RedemptionStatus.PENDING,
  RedemptionStatus.APPROVED,
];

type ReconciliationOrder = {
  id: string;
  userId: string;
  giftId: string;
  quantity: number;
  totalCost: number;
  status: RedemptionStatus;
  createdAt: Date;
  gift: { name: string; kind: "PHYSICAL" | "CASH" };
};

export type RedemptionReconciliationScope = {
  cutoff: Date;
  excludedGiftName: string;
  excluded: ReconciliationOrder[];
  fulfill: ReconciliationOrder[];
};

function scopeWhere(input: { cutoff: Date; excludedGiftName: string }): Prisma.RedemptionOrderWhereInput {
  return {
    status: { in: ACTIVE_REDEMPTION_STATUSES },
    createdAt: { lte: input.cutoff },
    gift: { name: { not: input.excludedGiftName } },
  };
}

function reconciliationRequestId(input: {
  cutoff: Date;
  excludedGiftName: string;
  reason: string;
}) {
  const digest = createHash("sha256")
    .update(`${input.cutoff.toISOString()}\0${input.excludedGiftName}\0${input.reason}`)
    .digest("hex");
  return `maintenance:redemption-reconciliation:${digest}`;
}

export async function inspectRedemptionReconciliation(input: {
  cutoff: Date;
  excludedGiftName: string;
}): Promise<RedemptionReconciliationScope> {
  const include = {
    gift: { select: { name: true, kind: true } },
  } as const;
  const [excluded, fulfill] = await Promise.all([
    db.redemptionOrder.findMany({
      where: {
        status: { in: ACTIVE_REDEMPTION_STATUSES },
        createdAt: { lte: input.cutoff },
        gift: { name: input.excludedGiftName },
      },
      include,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db.redemptionOrder.findMany({
      where: scopeWhere(input),
      include,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  return { ...input, excluded, fulfill };
}

export async function reconcileRedemptionOrders(input: {
  actorId: string;
  cutoff: Date;
  excludedGiftName: string;
  reason: string;
}) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("必须填写维护操作原因");
  const requestId = reconciliationRequestId({ ...input, reason });
  return db.$transaction(async (tx) => {
    const prior = await tx.auditLog.findFirst({
      where: {
        requestId,
        action: "REDEMPTION_RECONCILIATION_COMPLETED",
        entity: "RedemptionReconciliation",
      },
      select: { entityId: true },
    });
    if (prior?.entityId) {
      const refund = await tx.pointLedger.findUnique({
        where: { idempotencyKey: `maintenance:redemption:${prior.entityId}:refund` },
        select: { amount: true },
      });
      return {
        alreadyApplied: true,
        cutoff: input.cutoff,
        excludedOrderId: prior.entityId,
        refundedPoints: refund?.amount ?? 0,
        fulfilledCount: 0,
      };
    }

    const include = {
      gift: { select: { name: true, kind: true } },
    } as const;
    const [excluded, fulfill] = await Promise.all([
      tx.redemptionOrder.findMany({
        where: {
          status: { in: ACTIVE_REDEMPTION_STATUSES },
          createdAt: { lte: input.cutoff },
          gift: { name: input.excludedGiftName },
        },
        include,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      tx.redemptionOrder.findMany({
        where: scopeWhere(input),
        include,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    if (excluded.length !== 1) {
      throw new Error(`目标取消订单应为 1 条，实际找到 ${excluded.length} 条`);
    }

    const now = new Date();
    const excludedOrder = excluded[0];
    const claimedExcluded = await tx.redemptionOrder.updateMany({
      where: {
        id: excludedOrder.id,
        status: { in: ACTIVE_REDEMPTION_STATUSES },
        createdAt: { lte: input.cutoff },
      },
      data: { status: "REJECTED", reviewedAt: now, note: reason },
    });
    if (claimedExcluded.count !== 1) throw new Error("目标取消订单已被其他操作处理，请重新 dry-run");

    await tx.gift.update({
      where: { id: excludedOrder.giftId },
      data: { stock: { increment: excludedOrder.quantity } },
    });
    const account = await ensureAccount(excludedOrder.userId, tx);
    const updatedAccount = await tx.pointAccount.update({
      where: { id: account.id },
      data: { balance: { increment: excludedOrder.totalCost }, version: { increment: 1 } },
    });
    await tx.pointLedger.create({
      data: {
        accountId: account.id,
        amount: excludedOrder.totalCost,
        balanceAfter: updatedAccount.balance,
        type: "REDEMPTION_REFUND",
        referenceId: excludedOrder.id,
        note: reason,
        idempotencyKey: `maintenance:redemption:${excludedOrder.id}:refund`,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "REDEMPTION_REJECTED",
        entity: "RedemptionOrder",
        entityId: excludedOrder.id,
        beforeValue: { status: excludedOrder.status },
        afterValue: { status: "REJECTED", refunded: excludedOrder.totalCost, maintenance: true },
        reason,
        requestId,
      },
    });
    await createNotification(tx, {
      userId: excludedOrder.userId,
      type: "REDEMPTION",
      title: "兑换申请已取消，请重新提交",
      body: `${excludedOrder.gift.name} 兑换申请已取消，${excludedOrder.totalCost} 积分已退回。${reason} 请重新提交兑换申请。`,
      entityType: "RedemptionOrder",
      entityId: excludedOrder.id,
      metadata: { amount: excludedOrder.totalCost, status: "REJECTED", resubmit: true },
      dedupeKey: `redemption:${excludedOrder.id}:maintenance-rejected`,
    });

    const claimedFulfill = await tx.redemptionOrder.updateMany({
      where: {
        id: { in: fulfill.map((order) => order.id) },
        ...scopeWhere(input),
      },
      data: { status: "FULFILLED", reviewedAt: now },
    });
    if (claimedFulfill.count !== fulfill.length) {
      throw new Error("部分发放订单已被其他操作处理，事务已回滚，请重新 dry-run");
    }
    for (const order of fulfill) {
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "REDEMPTION_FULFILLED",
          entity: "RedemptionOrder",
          entityId: order.id,
          beforeValue: { status: order.status },
          afterValue: { status: "FULFILLED", maintenance: true },
          reason,
          requestId,
        },
      });
      await createNotification(tx, {
        userId: order.userId,
        type: "REDEMPTION",
        title: order.gift.kind === "CASH" ? "兑换已完成" : "礼品已发货",
        body: `${order.gift.name} 已完成发放`,
        entityType: "RedemptionOrder",
        entityId: order.id,
        metadata: { status: "FULFILLED", maintenance: true },
        dedupeKey: `redemption:${order.id}:fulfilled`,
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "REDEMPTION_RECONCILIATION_COMPLETED",
        entity: "RedemptionReconciliation",
        entityId: excludedOrder.id,
        afterValue: {
          cutoff: input.cutoff.toISOString(),
          excludedGiftName: input.excludedGiftName,
          refundedPoints: excludedOrder.totalCost,
          fulfilledCount: fulfill.length,
        },
        reason,
        requestId,
      },
    });
    return {
      cutoff: input.cutoff,
      excludedOrderId: excludedOrder.id,
      refundedPoints: excludedOrder.totalCost,
      fulfilledCount: fulfill.length,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

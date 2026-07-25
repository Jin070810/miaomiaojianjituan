import { db } from "./db";
import { LedgerType, Prisma, PrismaClient } from "@prisma/client";
import { decryptSensitive, encryptSensitive } from "./security";
import { calculateVideoPoints } from "./kuaishou";
import { getVideoPointRule } from "./point-rules";
import { createNotification } from "./notifications";
import { writeAuditLog } from "./audit";
import {
  evaluateWeeklyChallengeAfterVideoApproval,
  reconcileWeeklyChallengesAfterVideoRevocation,
} from "./weekly-challenges";

export async function ensureAccount(userId: string, tx: Prisma.TransactionClient | PrismaClient = db) {
  return tx.pointAccount.upsert({
    where: { userId },
    create: { userId, balance: 0 },
    update: {},
  });
}

async function credit(
  tx: Prisma.TransactionClient,
  userId: string,
  amount: number,
  type: LedgerType,
  referenceId: string,
  note?: string,
  idempotencyKey?: string,
) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("积分数量必须为正整数");
  const account = await ensureAccount(userId, tx);
  const updated = await tx.pointAccount.update({
    where: { id: account.id },
    data: { balance: { increment: amount }, version: { increment: 1 } },
  });
  await tx.pointLedger.create({
    data: { accountId: account.id, amount, balanceAfter: updated.balance, type, referenceId, note, idempotencyKey },
  });
  return updated;
}

async function debit(
  tx: Prisma.TransactionClient,
  userId: string,
  amount: number,
  type: LedgerType,
  referenceId: string,
  note?: string,
  idempotencyKey?: string,
) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("积分数量必须为正整数");
  const account = await ensureAccount(userId, tx);
  const changed = await tx.pointAccount.updateMany({
    where: { id: account.id, balance: { gte: amount } },
    data: { balance: { decrement: amount }, version: { increment: 1 } },
  });
  if (changed.count !== 1) throw new Error("积分余额不足");
  const updated = await tx.pointAccount.findUniqueOrThrow({ where: { id: account.id } });
  await tx.pointLedger.create({
    data: { accountId: account.id, amount: -amount, balanceAfter: updated.balance, type, referenceId, note, idempotencyKey },
  });
  return updated;
}

async function debitCompensating(
  tx: Prisma.TransactionClient,
  userId: string,
  amount: number,
  type: LedgerType,
  referenceId: string,
  note?: string,
) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("积分数量必须为正整数");
  const account = await ensureAccount(userId, tx);
  const updated = await tx.pointAccount.update({
    where: { id: account.id },
    data: { balance: { decrement: amount }, version: { increment: 1 } },
  });
  await tx.pointLedger.create({
    data: { accountId: account.id, amount: -amount, balanceAfter: updated.balance, type, referenceId, note },
  });
  return updated;
}

export async function completeTransfer(input: {
  senderId: string;
  receiverId: string;
  amount: number;
  note?: string;
  idempotencyKey: string;
  actorId?: string;
  ip?: string;
}) {
  if (input.senderId === input.receiverId) throw new Error("不能向自己转账");
  try {
    return await db.$transaction(async (tx) => {
    const existing = await tx.transfer.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
    const sender = await tx.user.findUnique({ where: { id: input.senderId } });
    const receiver = await tx.user.findUnique({ where: { id: input.receiverId } });
    if (!sender || !receiver || !sender.active || !receiver.active) throw new Error("转出或转入成员不存在或已停用");
    const transfer = await tx.transfer.create({
      data: {
        senderId: input.senderId,
        receiverId: input.receiverId,
        amount: input.amount,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await debit(tx, input.senderId, input.amount, "TRANSFER_OUT", transfer.id, input.note);
    await credit(tx, input.receiverId, input.amount, "TRANSFER_IN", transfer.id, input.note);
    await tx.auditLog.create({
      data: {
        actorId: input.actorId ?? input.senderId,
        action: "TRANSFER_COMPLETED",
        entity: "Transfer",
        entityId: transfer.id,
        afterValue: { amount: input.amount, senderId: input.senderId, receiverId: input.receiverId },
        ip: input.ip,
      },
    });
    await createNotification(tx, {
      userId: input.senderId,
      type: "TRANSFER",
      title: "积分转账已完成",
      body: `已向 ${receiver.nickname} 转出 ${input.amount} 积分${input.note ? `：${input.note}` : ""}`,
      entityType: "Transfer",
      entityId: transfer.id,
      metadata: { amount: -input.amount },
      dedupeKey: `transfer:${transfer.id}:sender`,
    });
    await createNotification(tx, {
      userId: input.receiverId,
      type: "TRANSFER",
      title: "收到积分转账",
      body: `${sender.nickname} 向你转入 ${input.amount} 积分${input.note ? `：${input.note}` : ""}`,
      entityType: "Transfer",
      entityId: transfer.id,
      metadata: { amount: input.amount },
      dedupeKey: `transfer:${transfer.id}:receiver`,
    });
    return transfer;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.transfer.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
    }
    throw error;
  }
}

export async function adminAdjustPoints(input: {
  userId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  actorId: string;
  ip?: string;
}) {
  if (!Number.isInteger(input.amount) || input.amount === 0 || Math.abs(input.amount) > 1_000_000) {
    throw new Error("调整积分必须是绝对值不超过 1000000 的非零整数");
  }
  const reason = input.reason.trim();
  if (reason.length < 2 || reason.length > 500) throw new Error("请填写 2 至 500 字的调整原因");

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.pointLedger.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { account: { include: { user: { select: { id: true, kuaishouId: true, nickname: true, active: true } } } } },
      });
      if (existing) return { ledger: existing, balance: existing.balanceAfter };

      const target = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, active: true } });
      if (!target || !target.active) throw new Error("目标成员不存在或已停用");
      const account = input.amount > 0
        ? await credit(tx, input.userId, input.amount, "ADMIN_ADJUSTMENT", input.idempotencyKey, reason, input.idempotencyKey)
        : await debit(tx, input.userId, -input.amount, "ADMIN_ADJUSTMENT", input.idempotencyKey, reason, input.idempotencyKey);
      const ledger = await tx.pointLedger.findUniqueOrThrow({
        where: { idempotencyKey: input.idempotencyKey },
        include: { account: { include: { user: { select: { id: true, kuaishouId: true, nickname: true, active: true } } } } },
      });
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: input.amount > 0 ? "ADMIN_POINTS_GRANTED" : "ADMIN_POINTS_DEDUCTED",
          entity: "PointAccount",
          entityId: account.id,
          beforeValue: { balance: account.balance - input.amount },
          afterValue: { balance: account.balance, amount: input.amount, userId: input.userId },
          reason,
          ip: input.ip,
          requestId: input.idempotencyKey,
        },
      });
      await createNotification(tx, {
        userId: input.userId,
        type: "POINTS",
        title: input.amount > 0 ? "管理员发放积分" : "管理员扣减积分",
        body: `${input.amount > 0 ? "增加" : "扣减"} ${Math.abs(input.amount)} 积分，当前余额 ${account.balance} 分。原因：${reason}`,
        entityType: "PointLedger",
        entityId: ledger.id,
        metadata: { amount: input.amount, balanceAfter: account.balance },
        dedupeKey: `admin-points:${input.idempotencyKey}:${input.userId}`,
      });
      return { ledger, balance: account.balance };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.pointLedger.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { account: { include: { user: { select: { id: true, kuaishouId: true, nickname: true, active: true } } } } },
      });
      if (existing) return { ledger: existing, balance: existing.balanceAfter };
    }
    throw error;
  }
}

export class BulkPointAdjustmentError extends Error {
  blockers: Array<{ userId: string; reason: string }>;

  constructor(message: string, blockers: Array<{ userId: string; reason: string }> = []) {
    super(message);
    this.name = "BulkPointAdjustmentError";
    this.blockers = blockers;
  }
}

export async function adminAdjustPointsBatch(input: {
  userIds: string[];
  amount: number;
  reason: string;
  idempotencyKey: string;
  actorId: string;
  ip?: string;
}) {
  if (!Number.isInteger(input.amount) || input.amount === 0 || Math.abs(input.amount) > 1_000_000) {
    throw new BulkPointAdjustmentError("调整积分必须是绝对值不超过 1000000 的非零整数");
  }
  const reason = input.reason.trim();
  if (reason.length < 2 || reason.length > 500) throw new BulkPointAdjustmentError("请填写 2 至 500 字的调整原因");
  const userIds = [...new Set(input.userIds)].sort();
  if (userIds.length < 1) throw new BulkPointAdjustmentError("批量调整至少需要选择一名成员");

  try {
    return await db.$transaction(async (tx) => {
      const keys = userIds.map((userId) => `${input.idempotencyKey}:${userId}`);
      const existing = await tx.pointLedger.findMany({
        where: { idempotencyKey: { in: keys } },
        include: { account: { include: { user: { select: { id: true, kuaishouId: true, nickname: true, active: true } } } } },
      });
      if (existing.length === userIds.length) {
        return {
          idempotencyKey: input.idempotencyKey,
          adjustments: existing.map((ledger) => ({ userId: ledger.account.userId, ledger, balance: ledger.balanceAfter })),
        };
      }
      if (existing.length > 0) throw new BulkPointAdjustmentError("该批量请求状态不完整，请使用新的请求标识重试");

      const members = await tx.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, active: true, role: true },
      });
      const byId = new Map(members.map((member) => [member.id, member]));
      const blockers = userIds
        .filter((userId) => !byId.has(userId))
        .map((userId) => ({ userId, reason: "成员不存在" }))
        .concat(userIds.filter((userId) => byId.has(userId) && !byId.get(userId)?.active).map((userId) => ({ userId, reason: "成员已停用" })))
        .concat(userIds.filter((userId) => byId.has(userId) && byId.get(userId)?.active && byId.get(userId)?.role !== "MEMBER").map((userId) => ({ userId, reason: "不是普通成员" })));
      if (blockers.length) throw new BulkPointAdjustmentError("批量调整未执行", blockers);
      if (input.amount < 0) {
        const accounts = await tx.pointAccount.findMany({ where: { userId: { in: userIds } }, select: { userId: true, balance: true } });
        const balances = new Map(accounts.map((account) => [account.userId, account.balance]));
        const insufficient = userIds
          .filter((userId) => (balances.get(userId) ?? 0) < Math.abs(input.amount))
          .map((userId) => ({ userId, reason: "积分余额不足" }));
        if (insufficient.length) throw new BulkPointAdjustmentError("批量调整未执行", insufficient);
      }

      const adjustments: Array<{ userId: string; ledger: Awaited<ReturnType<typeof tx.pointLedger.findUniqueOrThrow>>; balance: number }> = [];
      for (const userId of userIds) {
        const ledgerKey = `${input.idempotencyKey}:${userId}`;
        let account;
        try {
          account = input.amount > 0
            ? await credit(tx, userId, input.amount, "ADMIN_ADJUSTMENT", input.idempotencyKey, reason, ledgerKey)
            : await debit(tx, userId, -input.amount, "ADMIN_ADJUSTMENT", input.idempotencyKey, reason, ledgerKey);
        } catch (error) {
          if (input.amount < 0 && error instanceof Error && error.message === "积分余额不足") {
            throw new BulkPointAdjustmentError("批量调整未执行", [{ userId, reason: "积分余额不足或余额已发生并发变更" }]);
          }
          throw error;
        }
        const ledger = await tx.pointLedger.findUniqueOrThrow({
          where: { idempotencyKey: ledgerKey },
          include: { account: { include: { user: { select: { id: true, kuaishouId: true, nickname: true, active: true } } } } },
        });
        await tx.auditLog.create({
          data: {
            actorId: input.actorId,
            action: input.amount > 0 ? "ADMIN_POINTS_GRANTED" : "ADMIN_POINTS_DEDUCTED",
            entity: "PointAccount",
            entityId: account.id,
            beforeValue: { balance: account.balance - input.amount, userId },
            afterValue: { balance: account.balance, amount: input.amount, userId },
            reason,
            ip: input.ip,
            requestId: input.idempotencyKey,
          },
        });
        await createNotification(tx, {
          userId,
          type: "POINTS",
          title: input.amount > 0 ? "管理员发放积分" : "管理员扣减积分",
          body: `${input.amount > 0 ? "增加" : "扣减"} ${Math.abs(input.amount)} 积分，当前余额 ${account.balance} 分。原因：${reason}`,
          entityType: "PointLedger",
          entityId: ledger.id,
          metadata: { amount: input.amount, balanceAfter: account.balance },
          dedupeKey: `admin-points:${input.idempotencyKey}:${userId}`,
        });
        adjustments.push({ userId, ledger, balance: account.balance });
      }
      return { idempotencyKey: input.idempotencyKey, adjustments };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const keys = userIds.map((userId) => `${input.idempotencyKey}:${userId}`);
      const existing = await db.pointLedger.findMany({
        where: { idempotencyKey: { in: keys } },
        include: { account: { include: { user: { select: { id: true, kuaishouId: true, nickname: true, active: true } } } } },
      });
      if (existing.length === userIds.length) return { idempotencyKey: input.idempotencyKey, adjustments: existing.map((ledger) => ({ userId: ledger.account.userId, ledger, balance: ledger.balanceAfter })) };
    }
    throw error;
  }
}

export async function redeemGift(input: {
  userId: string;
  giftId: string;
  quantity: number;
  shippingInfo?: string;
  note?: string;
  recipient?: {
    recipientName?: string;
    phone?: string;
    address?: string;
    cashQrCodeUrl?: string;
  };
  idempotencyKey: string;
  ip?: string;
}) {
  try {
    return await db.$transaction(async (tx) => {
    const existing = await tx.redemptionOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 20) {
      throw new Error("兑换数量不合法");
    }
    const gift = await tx.gift.findUnique({ where: { id: input.giftId } });
    if (!gift || !gift.active) throw new Error("礼品不存在或已下架");
    const profile = await tx.recipientProfile.findUnique({ where: { userId: input.userId } });
    const recipientName = input.recipient?.recipientName?.trim() || profile?.recipientName || null;
    const recipientPhone = input.recipient?.phone?.trim() || (profile?.phoneEnc ? decryptSensitive(profile.phoneEnc) : null);
    const recipientAddress = input.recipient?.address?.trim() || (profile?.addressEnc ? decryptSensitive(profile.addressEnc) : null);
    const cashQrCodeUrl = input.recipient?.cashQrCodeUrl?.trim() || profile?.cashQrCodeUrl || null;
    if (gift.kind === "CASH" && !cashQrCodeUrl) throw new Error("兑换现金必须提供收款码");
    if (gift.kind === "PHYSICAL" && (!recipientName || !recipientPhone || !recipientAddress)) {
      throw new Error("兑换实物商品需要完整的收货姓名、手机号和详细地址");
    }
    const reserved = await tx.gift.updateMany({
      where: { id: gift.id, stock: { gte: input.quantity }, active: true },
      data: { stock: { decrement: input.quantity } },
    });
    if (reserved.count !== 1) throw new Error("礼品库存不足");
    const totalCost = gift.pointsCost * input.quantity;
    const order = await tx.redemptionOrder.create({
      data: {
        userId: input.userId,
        giftId: gift.id,
        quantity: input.quantity,
        unitCost: gift.pointsCost,
        totalCost,
        shippingInfo: input.shippingInfo,
        recipientName,
        recipientPhoneEnc: recipientPhone ? encryptSensitive(recipientPhone) : null,
        recipientAddressEnc: recipientAddress ? encryptSensitive(recipientAddress) : null,
        cashQrCodeUrl,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
        // 积分和库存已在同一事务内校验并扣除，兑换创建后直接进入待发货。
        status: "APPROVED",
      },
    });
    if (input.recipient) {
      await tx.recipientProfile.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          recipientName: input.recipient.recipientName?.trim() || null,
          phoneEnc: input.recipient.phone?.trim() ? encryptSensitive(input.recipient.phone.trim()) : null,
          addressEnc: input.recipient.address?.trim() ? encryptSensitive(input.recipient.address.trim()) : null,
          cashQrCodeUrl: input.recipient.cashQrCodeUrl?.trim() || null,
        },
        update: {
          ...(input.recipient.recipientName !== undefined ? { recipientName: input.recipient.recipientName.trim() || null } : {}),
          ...(input.recipient.phone !== undefined ? { phoneEnc: input.recipient.phone.trim() ? encryptSensitive(input.recipient.phone.trim()) : null } : {}),
          ...(input.recipient.address !== undefined ? { addressEnc: input.recipient.address.trim() ? encryptSensitive(input.recipient.address.trim()) : null } : {}),
          ...(input.recipient.cashQrCodeUrl !== undefined ? { cashQrCodeUrl: input.recipient.cashQrCodeUrl.trim() || null } : {}),
        },
      });
    }
    await debit(tx, input.userId, totalCost, "REDEMPTION", order.id, `兑换${gift.name}`);
    await tx.auditLog.create({
      data: {
        actorId: input.userId,
        action: "REDEMPTION_CREATED",
        entity: "RedemptionOrder",
        entityId: order.id,
        afterValue: { giftId: gift.id, quantity: input.quantity, totalCost },
        ip: input.ip,
      },
    });
    await createNotification(tx, {
      userId: input.userId,
      type: "REDEMPTION",
      title: "兑换申请已提交",
      body: `已使用 ${totalCost} 积分兑换 ${gift.name}，订单进入${gift.kind === "PHYSICAL" ? "待采购" : "待发放"}状态`,
      entityType: "RedemptionOrder",
      entityId: order.id,
      metadata: { amount: -totalCost, status: order.status },
      dedupeKey: `redemption:${order.id}:created`,
    });
    return order;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.redemptionOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
    }
    throw error;
  }
}

export async function creditVideoReward(input: {
  videoId: string;
  userId: string;
  points: number;
  actorId?: string;
  ip?: string;
}) {
  return db.$transaction(async (tx) => {
    const video = await tx.videoSubmission.findUnique({ where: { id: input.videoId } });
    if (!video) throw new Error("视频记录不存在");
    if (video.status === "APPROVED" && (!input.actorId || video.points === input.points)) return video;
    if (video.status === "APPROVED" && input.actorId && video.points !== input.points) {
      const delta = input.points - video.points;
      if (delta > 0) await credit(tx, input.userId, delta, "ADMIN_ADJUSTMENT", video.id, "管理员调整视频积分");
      if (delta < 0) await debitCompensating(tx, input.userId, -delta, "ADMIN_ADJUSTMENT", video.id, "管理员调整视频积分");
      const adjusted = await tx.videoSubmission.update({ where: { id: video.id }, data: { points: input.points, reviewedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "VIDEO_POINTS_ADJUSTED",
          entity: "VideoSubmission",
          entityId: video.id,
          beforeValue: { points: video.points },
          afterValue: { points: input.points },
          ip: input.ip,
        },
      });
      await createNotification(tx, {
        userId: input.userId,
        type: "VIDEO_RESULT",
        title: "视频积分已调整",
        body: `视频积分由 ${video.points} 分调整为 ${input.points} 分，本次变动 ${delta >= 0 ? "+" : ""}${delta} 分`,
        entityType: "VideoSubmission",
        entityId: video.id,
        metadata: { amount: delta, points: input.points, status: adjusted.status },
        dedupeKey: `video:${video.id}:points:${input.points}`,
      });
      return adjusted;
    }
    if (!["PROCESSING", "PENDING_REVIEW", "FAILED"].includes(video.status)) {
      throw new Error("只有处理中视频可以自动入账");
    }
    const claimed = await tx.videoSubmission.updateMany({
      where: { id: video.id, status: { in: ["PROCESSING", "PENDING_REVIEW", "FAILED"] } },
      data: { status: "APPROVED", points: input.points, processedAt: new Date(), reviewedAt: new Date() },
    });
    if (claimed.count !== 1) return tx.videoSubmission.findUniqueOrThrow({ where: { id: video.id } });
    const updated = await tx.videoSubmission.update({
      where: { id: video.id },
      data: { points: input.points },
    });
    if (input.points > 0) {
      await credit(tx, input.userId, input.points, "VIDEO_REWARD", video.id, "视频审核通过");
    }
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "VIDEO_APPROVED",
        entity: "VideoSubmission",
        entityId: video.id,
        beforeValue: { status: video.status, points: video.points },
        afterValue: { status: updated.status, points: updated.points },
        ip: input.ip,
      },
    });
    await createNotification(tx, {
      userId: input.userId,
      type: "VIDEO_RESULT",
      title: "视频审核通过",
      body: `视频已通过校验${input.points > 0 ? `，${input.points} 积分已到账` : ""}`,
      entityType: "VideoSubmission",
      entityId: video.id,
      metadata: { amount: input.points, points: input.points, status: "APPROVED" },
      dedupeKey: `video:${video.id}:approved`,
    });
    await evaluateWeeklyChallengeAfterVideoApproval(tx, {
      userId: input.userId,
      submittedAt: video.submittedAt,
      completedAt: updated.reviewedAt ?? new Date(),
    });
    return updated;
  });
}

export async function rejectVideo(input: { videoId: string; reason: string; actorId: string; ip?: string }) {
  return db.$transaction(async (tx) => {
    const video = await tx.videoSubmission.findUniqueOrThrow({ where: { id: input.videoId } });
    if (video.status === "APPROVED" || video.status === "REVOKED") {
      throw new Error("已到账视频请使用撤销操作");
    }
    const updated = await tx.videoSubmission.update({
      where: { id: input.videoId },
      data: { status: "REJECTED", reviewReason: input.reason, reviewedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "VIDEO_REJECTED",
        entity: "VideoSubmission",
        entityId: input.videoId,
        beforeValue: { status: video.status },
        afterValue: { status: updated.status, reason: input.reason },
        reason: input.reason,
        ip: input.ip,
      },
    });
    await createNotification(tx, {
      userId: video.userId,
      type: "VIDEO_RESULT",
      title: "视频未通过审核",
      body: input.reason,
      entityType: "VideoSubmission",
      entityId: video.id,
      metadata: { status: "REJECTED" },
      dedupeKey: `video:${video.id}:rejected:${updated.reviewedAt?.toISOString() ?? "manual"}`,
    });
    return updated;
  });
}

export async function resolveVideoAppeal(input: {
  appealId: string;
  action: "approve" | "reject";
  actorId: string;
  reason?: string;
  points?: number;
  ip?: string;
}) {
  return db.$transaction(async (tx) => {
    const appeal = await tx.videoAppeal.findUnique({
      where: { id: input.appealId },
      include: { video: true },
    });
    if (!appeal) throw new Error("申诉记录不存在");
    if (appeal.status !== "PENDING") return appeal;
    if (input.action === "reject") {
      const reason = input.reason?.trim();
      if (!reason) throw new Error("驳回申诉必须填写原因");
      const claimed = await tx.videoAppeal.updateMany({
        where: { id: appeal.id, status: "PENDING" },
        data: { status: "REJECTED", reviewReason: reason, reviewedAt: new Date(), reviewedById: input.actorId },
      });
      if (claimed.count !== 1) return tx.videoAppeal.findUniqueOrThrow({ where: { id: appeal.id } });
      const updated = await tx.videoAppeal.findUniqueOrThrow({ where: { id: appeal.id } });
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "VIDEO_APPEAL_REJECTED",
          entity: "VideoAppeal",
          entityId: appeal.id,
          beforeValue: { status: appeal.status },
          afterValue: { status: updated.status, videoId: appeal.videoId },
          reason,
          ip: input.ip,
        },
      });
      await createNotification(tx, {
        userId: appeal.userId,
        type: "APPEAL_RESULT",
        title: "视频申诉未通过",
        body: reason,
        entityType: "VideoAppeal",
        entityId: appeal.id,
        metadata: { status: "REJECTED", videoId: appeal.videoId },
        dedupeKey: `appeal:${appeal.id}:rejected`,
      });
      return updated;
    }

    if (appeal.video.status !== "REJECTED") throw new Error("只有已自动驳回的视频可以通过申诉");
    const duplicate = appeal.video.photoId
      ? await tx.videoSubmission.findFirst({
          where: {
            photoId: appeal.video.photoId,
            id: { not: appeal.video.id },
            status: { in: ["PROCESSING", "PENDING_REVIEW", "APPROVED"] },
          },
        })
      : null;
    if (duplicate) throw new Error("该视频已被其他记录结算，不能通过申诉");
    const rule = await getVideoPointRule(tx);
    const points = input.points ?? calculateVideoPoints(appeal.video.likes ?? 0, rule);
    if (!Number.isInteger(points) || points < 0 || points > rule.maximumPoints) {
      throw new Error(`申诉积分必须是 0 至 ${rule.maximumPoints} 的整数`);
    }
    const claimed = await tx.videoAppeal.updateMany({
      where: { id: appeal.id, status: "PENDING" },
      data: {
        status: "APPROVED",
        reviewedPoints: points,
        reviewReason: input.reason?.trim() || "申诉复查通过",
        reviewedAt: new Date(),
        reviewedById: input.actorId,
      },
    });
    if (claimed.count !== 1) return tx.videoAppeal.findUniqueOrThrow({ where: { id: appeal.id } });
    const video = await tx.videoSubmission.update({
      where: { id: appeal.video.id },
      data: { status: "APPROVED", points, reviewedAt: new Date(), reviewReason: input.reason?.trim() || "申诉复查通过" },
    });
    if (points > 0) {
      await credit(tx, appeal.video.userId, points, "VIDEO_REWARD", appeal.video.id, "视频申诉通过");
    }
    const updated = await tx.videoAppeal.findUniqueOrThrow({ where: { id: appeal.id } });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "VIDEO_APPEAL_APPROVED",
        entity: "VideoAppeal",
        entityId: appeal.id,
        beforeValue: { appealStatus: appeal.status, videoStatus: appeal.video.status, points: appeal.video.points },
        afterValue: { appealStatus: updated.status, videoStatus: video.status, points },
        reason: input.reason,
        ip: input.ip,
      },
    });
    await createNotification(tx, {
      userId: appeal.userId,
      type: "APPEAL_RESULT",
      title: "视频申诉已通过",
      body: `申诉复查通过${points > 0 ? `，${points} 积分已到账` : ""}`,
      entityType: "VideoAppeal",
      entityId: appeal.id,
      metadata: { amount: points, points, status: "APPROVED", videoId: appeal.videoId },
      dedupeKey: `appeal:${appeal.id}:approved`,
    });
    await evaluateWeeklyChallengeAfterVideoApproval(tx, {
      userId: appeal.userId,
      submittedAt: video.submittedAt,
      completedAt: video.reviewedAt ?? new Date(),
    });
    return updated;
  });
}

export async function revokeVideoReward(input: { videoId: string; actorId: string; reason: string; ip?: string }) {
  return db.$transaction(async (tx) => {
    const video = await tx.videoSubmission.findUniqueOrThrow({ where: { id: input.videoId } });
    if (video.status === "REVOKED") return video;
    if (video.status !== "APPROVED") throw new Error("只有已到账视频可以撤销");
    const claimed = await tx.videoSubmission.updateMany({
      where: { id: video.id, status: "APPROVED" },
      data: { status: "REVOKED", reviewReason: input.reason, reviewedAt: new Date() },
    });
    if (claimed.count !== 1) return tx.videoSubmission.findUniqueOrThrow({ where: { id: video.id } });
    if (video.points > 0) {
      await debitCompensating(tx, video.userId, video.points, "REVERSAL", video.id, `撤销视频奖励：${input.reason}`);
    }
    const updated = await tx.videoSubmission.findUniqueOrThrow({ where: { id: video.id } });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "VIDEO_REVOKED",
        entity: "VideoSubmission",
        entityId: video.id,
        beforeValue: { status: video.status, points: video.points },
        afterValue: { status: updated.status, points: 0 },
        reason: input.reason,
        ip: input.ip,
      },
    });
    await createNotification(tx, {
      userId: video.userId,
      type: "VIDEO_RESULT",
      title: "视频奖励已撤销",
      body: `${input.reason}${video.points > 0 ? `，已扣回 ${video.points} 积分` : ""}`,
      entityType: "VideoSubmission",
      entityId: video.id,
      metadata: { amount: -video.points, status: "REVOKED" },
      dedupeKey: `video:${video.id}:revoked`,
    });
    await reconcileWeeklyChallengesAfterVideoRevocation(tx, {
      userId: video.userId,
      submittedAt: video.submittedAt,
      videoId: video.id,
      reason: input.reason,
    });
    return updated;
  });
}

export async function updateRedemptionOrder(input: {
  orderId: string;
  action: "approve" | "fulfill" | "update_tracking" | "reject" | "refund";
  actorId: string;
  reason?: string;
  trackingNumber?: string | null;
  ip?: string;
}) {
  return db.$transaction(async (tx) => {
    const order = await tx.redemptionOrder.findUnique({
      where: { id: input.orderId },
      include: { gift: true, user: { select: { nickname: true, kuaishouId: true } } },
    });
    if (!order) throw new Error("兑换订单不存在");
    if (input.action === "update_tracking") {
      if (order.gift.kind !== "PHYSICAL") throw new Error("只有实物订单可以填写快递单号");
      if (order.status !== "FULFILLED") throw new Error("只有已发货的实物订单可以修改快递单号");
      const trackingNumber = input.trackingNumber?.trim() || null;
      if (trackingNumber && trackingNumber.length > 120) throw new Error("快递单号不能超过 120 个字符");
      if (trackingNumber === order.trackingNumber) return order;
      const updated = await tx.redemptionOrder.update({
        where: { id: order.id },
        data: { trackingNumber },
      });
      await writeAuditLog(tx, {
          actorId: input.actorId,
          action: "REDEMPTION_TRACKING_UPDATED",
          entity: "RedemptionOrder",
          entityId: order.id,
          beforeValue: { trackingNumber: order.trackingNumber },
          afterValue: { trackingNumber },
          reason: input.reason,
          ip: input.ip,
      });
      await createNotification(tx, {
        userId: order.userId,
        type: "REDEMPTION",
        title: "物流信息已更新",
        body: trackingNumber ? `${order.gift.name} 的快递单号已更新为 ${trackingNumber}` : `${order.gift.name} 的快递单号已清除`,
        entityType: "RedemptionOrder",
        entityId: order.id,
        metadata: { status: "FULFILLED", trackingNumber },
        dedupeKey: `redemption:${order.id}:tracking:${trackingNumber ?? "empty"}`,
      });
      return updated;
    }
    if (input.action === "approve") {
      if (order.status !== "PENDING") return order;
      const updated = await tx.redemptionOrder.update({ where: { id: order.id }, data: { status: "APPROVED", reviewedAt: new Date() } });
      await tx.auditLog.create({
        data: { actorId: input.actorId, action: "REDEMPTION_APPROVED", entity: "RedemptionOrder", entityId: order.id, beforeValue: { status: order.status }, afterValue: { status: updated.status }, reason: input.reason, ip: input.ip },
      });
      await createNotification(tx, {
        userId: order.userId,
        type: "REDEMPTION",
        title: "兑换订单已确认",
        body: `${order.gift.name} 已确认，等待发放`,
        entityType: "RedemptionOrder",
        entityId: order.id,
        metadata: { status: "APPROVED" },
        dedupeKey: `redemption:${order.id}:approved`,
      });
      return updated;
    }
    if (input.action === "fulfill") {
      if (!["APPROVED", "PENDING"].includes(order.status)) return order;
      if (order.gift.kind === "CASH" && !order.cashQrCodeUrl) {
        throw new Error("现金订单缺少收款码，补齐后才能完成");
      }
      if (order.gift.kind === "PHYSICAL" && (!order.recipientName || !order.recipientPhoneEnc || !order.recipientAddressEnc)) {
        throw new Error("实物订单缺少完整收货资料，补齐后才能发货");
      }
      const fulfilledAt = new Date();
      const trackingNumber = order.gift.kind === "PHYSICAL" ? input.trackingNumber?.trim() || null : null;
      if (trackingNumber && trackingNumber.length > 120) throw new Error("快递单号不能超过 120 个字符");
      const updated = await tx.redemptionOrder.update({
        where: { id: order.id },
        data: { status: "FULFILLED", reviewedAt: fulfilledAt, fulfilledAt, trackingNumber },
      });
      await writeAuditLog(tx, {
          actorId: input.actorId,
          action: "REDEMPTION_FULFILLED",
          entity: "RedemptionOrder",
          entityId: order.id,
          beforeValue: { status: order.status },
          afterValue: {
            status: updated.status,
            trackingNumber,
            giftName: order.gift.name,
            targetNickname: order.user.nickname,
            giftKind: order.gift.kind,
          },
          reason: input.reason,
          ip: input.ip,
      });
      await createNotification(tx, {
        userId: order.userId,
        type: "REDEMPTION",
        title: order.gift.kind === "CASH" ? "兑换已完成" : "礼品已发货",
        body: `${order.gift.name} 已完成${order.gift.kind === "CASH" ? "发放" : "发货"}${trackingNumber ? `，快递单号：${trackingNumber}` : ""}`,
        entityType: "RedemptionOrder",
        entityId: order.id,
        metadata: { status: "FULFILLED", trackingNumber },
        dedupeKey: `redemption:${order.id}:fulfilled`,
      });
      return updated;
    }
    if (input.action === "reject" && !["PENDING", "APPROVED"].includes(order.status)) {
      throw new Error("只有待发货订单可以驳回");
    }
    if (["REJECTED", "REFUNDED"].includes(order.status)) return order;
    const nextStatus = input.action === "refund" ? "REFUNDED" : "REJECTED";
    const claimed = await tx.redemptionOrder.updateMany({
      where: { id: order.id, status: { in: ["PENDING", "APPROVED", "FULFILLED"] } },
      data: { status: nextStatus, reviewedAt: new Date(), note: input.reason ?? order.note },
    });
    if (claimed.count !== 1) return tx.redemptionOrder.findUniqueOrThrow({ where: { id: order.id } });
    await tx.gift.update({ where: { id: order.giftId }, data: { stock: { increment: order.quantity } } });
    await credit(tx, order.userId, order.totalCost, "REDEMPTION_REFUND", order.id, input.reason ?? "兑换订单退款");
    const updated = await tx.redemptionOrder.findUniqueOrThrow({ where: { id: order.id } });
    await writeAuditLog(tx, {
        actorId: input.actorId,
        action: input.action === "refund" ? "REDEMPTION_REFUNDED" : "REDEMPTION_REJECTED",
        entity: "RedemptionOrder",
        entityId: order.id,
        beforeValue: { status: order.status },
        afterValue: {
          status: updated.status,
          refunded: order.totalCost,
          giftName: order.gift.name,
          targetNickname: order.user.nickname,
        },
        reason: input.reason,
        ip: input.ip,
    });
    await createNotification(tx, {
      userId: order.userId,
      type: "REDEMPTION",
      title: input.action === "refund" ? "兑换订单已退款" : "兑换订单已驳回",
      body: `${order.gift.name} 已${input.action === "refund" ? "退款" : "驳回"}，${order.totalCost} 积分已退回${input.reason ? `。原因：${input.reason}` : ""}`,
      entityType: "RedemptionOrder",
      entityId: order.id,
      metadata: { amount: order.totalCost, status: updated.status },
      dedupeKey: `redemption:${order.id}:${updated.status.toLowerCase()}`,
    });
    return updated;
  });
}

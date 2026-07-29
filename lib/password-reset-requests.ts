import { Prisma, type PasswordResetRequestStatus, type Role } from "@prisma/client";
import { db } from "./db";
import { writeAuditLog } from "./audit";

const REQUEST_LIFETIME_MS = 24 * 60 * 60 * 1000;

type Transaction = Prisma.TransactionClient;

function maskKuaishouId(value: string) {
  if (value.length <= 4) return `${value.slice(0, 1)}***`;
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

async function expirePendingRequests(tx: Transaction, now: Date) {
  const expired = await tx.passwordResetRequest.findMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    select: { id: true, userId: true },
  });
  if (!expired.length) return;
  await tx.passwordResetRequest.updateMany({
    where: { id: { in: expired.map((request) => request.id) }, status: "PENDING" },
    data: { status: "EXPIRED" },
  });
  await tx.auditLog.createMany({
    data: expired.map((request) => ({
      action: "PASSWORD_RESET_EXPIRED",
      entity: "PasswordResetRequest",
      entityId: request.id,
      afterValue: { userId: request.userId },
    })),
  });
}

export async function createPasswordResetRequest(input: {
  kuaishouId: string;
  proposedPasswordHash: string;
  ip: string | null;
  requestId: string;
}) {
  const now = new Date();
  return db.$transaction(async (tx) => {
    await expirePendingRequests(tx, now);
    const user = await tx.user.findFirst({
      where: { kuaishouId: { equals: input.kuaishouId, mode: "insensitive" }, active: true },
      select: { id: true },
    });
    // Deliberately return the same public result for missing accounts and existing requests.
    if (!user) return { accepted: true, created: false };
    const existing = await tx.passwordResetRequest.findFirst({
      where: { userId: user.id, status: "PENDING", expiresAt: { gt: now } },
      select: { id: true },
    });
    if (existing) return { accepted: true, created: false };
    const request = await tx.passwordResetRequest.create({
      data: {
        userId: user.id,
        proposedPasswordHash: input.proposedPasswordHash,
        expiresAt: new Date(now.getTime() + REQUEST_LIFETIME_MS),
      },
    });
    await writeAuditLog(tx, {
      action: "PASSWORD_RESET_REQUESTED",
      entity: "PasswordResetRequest",
      entityId: request.id,
      afterValue: { userId: user.id, expiresAt: request.expiresAt.toISOString() },
      ip: input.ip,
      requestId: input.requestId,
    });
    return { accepted: true, created: true };
  });
}

export async function listPendingPasswordResetRequests() {
  const now = new Date();
  return db.$transaction(async (tx) => {
    await expirePendingRequests(tx, now);
    const requests = await tx.passwordResetRequest.findMany({
      where: { status: "PENDING", expiresAt: { gt: now } },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        user: { select: { kuaishouId: true, nickname: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
    });
    return requests.map((request) => ({
      ...request,
      user: { ...request.user, kuaishouId: maskKuaishouId(request.user.kuaishouId) },
    }));
  });
}

export async function reviewPasswordResetRequest(input: {
  requestId: string;
  action: "APPROVE" | "REJECT";
  approver: { id: string; role: Role };
  ip: string | null;
  auditRequestId: string;
}) {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const request = await tx.passwordResetRequest.findUnique({
      where: { id: input.requestId },
      include: { user: { select: { id: true, kuaishouId: true, role: true } } },
    });
    if (!request || request.status !== "PENDING") throw new Error("申请不存在或已处理");
    if (request.expiresAt <= now) {
      await tx.passwordResetRequest.update({ where: { id: request.id }, data: { status: "EXPIRED" } });
      await writeAuditLog(tx, {
        action: "PASSWORD_RESET_EXPIRED",
        entity: "PasswordResetRequest",
        entityId: request.id,
        afterValue: { userId: request.userId },
      });
      throw new Error("申请已过期");
    }
    if (request.user.id === input.approver.id) throw new Error("不能审批自己的密码找回申请");
    if (input.approver.role === "REVIEWER" && request.user.role !== "MEMBER") {
      throw new Error("审核员不能处理其他审核员或管理员的申请");
    }
    if (input.action === "REJECT") {
      await tx.passwordResetRequest.update({
        where: { id: request.id },
        data: { status: "REJECTED", reviewedById: input.approver.id, reviewedAt: now },
      });
      await writeAuditLog(tx, {
        actorId: input.approver.id,
        action: "PASSWORD_RESET_REJECTED",
        entity: "PasswordResetRequest",
        entityId: request.id,
        afterValue: { userId: request.userId, targetKuaishouId: request.user.kuaishouId },
        ip: input.ip,
        requestId: input.auditRequestId,
      });
      return { status: "REJECTED" as PasswordResetRequestStatus };
    }
    await tx.user.update({ where: { id: request.userId }, data: { passwordHash: request.proposedPasswordHash } });
    await tx.session.deleteMany({ where: { userId: request.userId } });
    await tx.passwordResetRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED", reviewedById: input.approver.id, reviewedAt: now },
    });
    await writeAuditLog(tx, {
      actorId: input.approver.id,
      action: "PASSWORD_RESET_APPROVED",
      entity: "PasswordResetRequest",
      entityId: request.id,
      afterValue: { userId: request.userId, targetKuaishouId: request.user.kuaishouId, sessionsRevoked: true },
      ip: input.ip,
      requestId: input.auditRequestId,
    });
    return { status: "APPROVED" as PasswordResetRequestStatus };
  });
}

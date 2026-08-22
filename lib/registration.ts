import crypto from "node:crypto";
import { Prisma, RegistrationApplicationStatus, type Role } from "@prisma/client";
import { db } from "./db";
import { writeAuditLog } from "./audit";
import { decryptPhone, encryptPhone, hashPassword } from "./security";
import { ensureNewMemberEligibility } from "./member-clearance";

const TOKEN_BYTES = 32;
const LINK_MAX_DAYS = 365;

type Transaction = Prisma.TransactionClient;

export const registrationApplicationStatuses = ["PENDING", "APPROVED", "REJECTED"] as const;

export function createOpaqueToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashOpaqueToken(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function maskPhone(value: string | null) {
  if (!value) return null;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function validateExpiresAt(value: Date | null | undefined, now = new Date()) {
  if (!value) return null;
  if (Number.isNaN(value.getTime()) || value <= now) throw new Error("链接失效时间必须晚于当前时间");
  if (value.getTime() > now.getTime() + LINK_MAX_DAYS * 86_400_000) throw new Error("链接有效期不能超过 365 天");
  return value;
}

function isLinkAvailable(link: { active: boolean; expiresAt: Date | null }, now = new Date()) {
  return link.active && (!link.expiresAt || link.expiresAt > now);
}

export async function getRegistrationInviteStatus(token: string) {
  const link = await db.registrationInviteLink.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    select: { active: true, expiresAt: true },
  });
  return link ? { available: isLinkAvailable(link), expiresAt: link.expiresAt } : { available: false, expiresAt: null };
}

export async function createRegistrationInviteLink(input: {
  actorId: string;
  expiresAt?: Date | null;
  ip?: string | null;
  requestId?: string | null;
}) {
  const now = new Date();
  const expiresAt = validateExpiresAt(input.expiresAt, now);
  const token = createOpaqueToken();
  const link = await db.$transaction(async (tx) => {
    await tx.registrationInviteLink.updateMany({ where: { active: true }, data: { active: false, revokedAt: now } });
    const created = await tx.registrationInviteLink.create({
      data: { tokenHash: hashOpaqueToken(token), expiresAt, createdById: input.actorId },
    });
    await writeAuditLog(tx, {
      actorId: input.actorId,
      action: "REGISTRATION_INVITE_LINK_CREATED",
      entity: "RegistrationInviteLink",
      entityId: created.id,
      afterValue: { active: true, expiresAt: created.expiresAt?.toISOString() ?? null },
      ip: input.ip,
      requestId: input.requestId,
    });
    return created;
  });
  return { link, token };
}

export async function getRegistrationInviteLink() {
  return db.registrationInviteLink.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true, active: true, expiresAt: true, revokedAt: true, createdAt: true, updatedAt: true },
  });
}

export async function revokeRegistrationInviteLink(input: { id: string; actorId: string; ip?: string | null; requestId?: string | null }) {
  return db.$transaction(async (tx) => {
    const existing = await tx.registrationInviteLink.findUnique({ where: { id: input.id } });
    if (!existing) throw new Error("入团链接不存在");
    if (!existing.active) return existing;
    const updated = await tx.registrationInviteLink.update({ where: { id: input.id }, data: { active: false, revokedAt: new Date() } });
    await writeAuditLog(tx, {
      actorId: input.actorId,
      action: "REGISTRATION_INVITE_LINK_REVOKED",
      entity: "RegistrationInviteLink",
      entityId: input.id,
      beforeValue: { active: true, expiresAt: existing.expiresAt?.toISOString() ?? null },
      afterValue: { active: false, revokedAt: updated.revokedAt?.toISOString() ?? null },
      ip: input.ip,
      requestId: input.requestId,
    });
    return updated;
  });
}

export type RegistrationApplicationInput = {
  token: string;
  kuaishouId: string;
  nickname: string;
  password: string;
  guildStatus?: string;
  boundPhone?: string;
  ip?: string | null;
  requestId?: string | null;
};

export async function submitRegistrationApplication(input: RegistrationApplicationInput) {
  if (input.guildStatus === "未绑定" && !input.boundPhone) throw new Error("未绑定公会时需要填写绑定手机号");
  const initialLink = await db.registrationInviteLink.findUnique({ where: { tokenHash: hashOpaqueToken(input.token) }, select: { active: true, expiresAt: true } });
  if (!initialLink || !isLinkAvailable(initialLink)) throw new Error("入团链接无效或已失效");
  const queryToken = createOpaqueToken();
  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  return db.$transaction(async (tx) => {
    const link = await tx.registrationInviteLink.findUnique({ where: { tokenHash: hashOpaqueToken(input.token) } });
    if (!link || !isLinkAvailable(link, now)) throw new Error("入团链接无效或已失效");
    const existingUser = await tx.user.findFirst({ where: { kuaishouId: { equals: input.kuaishouId, mode: "insensitive" } }, select: { id: true } });
    if (existingUser) throw new Error("该快手ID已注册，不能重复申请");
    const existingApplication = await tx.registrationApplication.findFirst({
      where: { kuaishouId: { equals: input.kuaishouId, mode: "insensitive" }, status: "PENDING" },
      select: { id: true },
    });
    if (existingApplication) throw new Error("该快手ID已有待审核申请");
    const application = await tx.registrationApplication.create({
      data: {
        inviteLinkId: link.id,
        kuaishouId: input.kuaishouId,
        nickname: input.nickname,
        guildStatus: input.guildStatus || null,
        boundPhoneEnc: input.boundPhone ? encryptPhone(input.boundPhone) : null,
        proposedPasswordHash: passwordHash,
        queryTokenHash: hashOpaqueToken(queryToken),
      },
    });
    await writeAuditLog(tx, {
      action: "REGISTRATION_APPLICATION_SUBMITTED",
      entity: "RegistrationApplication",
      entityId: application.id,
      afterValue: { kuaishouId: application.kuaishouId, nickname: application.nickname, guildStatus: application.guildStatus },
      ip: input.ip,
      requestId: input.requestId,
    });
    return { applicationId: application.id, queryToken, status: application.status };
  });
}

export async function getRegistrationApplicationStatus(input: { applicationId: string; queryToken: string }) {
  const application = await db.registrationApplication.findFirst({
    where: { id: input.applicationId, queryTokenHash: hashOpaqueToken(input.queryToken) },
    select: { id: true, status: true, reviewReason: true, createdAt: true, reviewedAt: true },
  });
  if (!application) throw new Error("申请编号或查询凭证不正确");
  return application;
}

export async function listRegistrationApplications(status: RegistrationApplicationStatus = "PENDING") {
  const applications = await db.registrationApplication.findMany({
    where: { status },
    select: {
      id: true,
      kuaishouId: true,
      nickname: true,
      guildStatus: true,
      boundPhoneEnc: true,
      status: true,
      reviewReason: true,
      reviewedAt: true,
      createdAt: true,
      reviewedBy: { select: { id: true, nickname: true, role: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  return applications.map(({ boundPhoneEnc, ...application }) => ({
    ...application,
    boundPhone: boundPhoneEnc ? maskPhone(decryptPhone(boundPhoneEnc)) : null,
  }));
}

export async function reviewRegistrationApplication(input: {
  applicationId: string;
  action: "APPROVE" | "REJECT";
  reason?: string;
  reviewer: { id: string; role: Role };
  ip?: string | null;
  requestId?: string | null;
}) {
  const reason = input.reason?.trim() || null;
  if (input.action === "REJECT" && (!reason || reason.length < 2)) throw new Error("驳回申请必须填写原因");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "RegistrationApplication" WHERE "id" = ${input.applicationId} FOR UPDATE`;
    const application = await tx.registrationApplication.findUnique({ where: { id: input.applicationId } });
    if (!application) throw new Error("入团申请不存在");
    if (application.status !== "PENDING") return { status: application.status, applicationId: application.id, idempotent: true };
    const now = new Date();
    if (input.action === "REJECT") {
      const updated = await tx.registrationApplication.update({
        where: { id: application.id },
        data: { status: "REJECTED", reviewReason: reason, reviewedAt: now, reviewedById: input.reviewer.id, proposedPasswordHash: null },
      });
      await writeAuditLog(tx, {
        actorId: input.reviewer.id,
        action: "REGISTRATION_APPLICATION_REJECTED",
        entity: "RegistrationApplication",
        entityId: application.id,
        afterValue: { kuaishouId: application.kuaishouId, status: updated.status },
        reason,
        ip: input.ip,
        requestId: input.requestId,
      });
      return { status: updated.status, applicationId: updated.id, idempotent: false };
    }
    const existingUser = await tx.user.findFirst({ where: { kuaishouId: { equals: application.kuaishouId, mode: "insensitive" } }, select: { id: true } });
    if (existingUser) throw new Error("该快手ID已注册，请先驳回该申请");
    if (!application.proposedPasswordHash) throw new Error("申请密码已失效，请驳回后重新提交");
    const user = await tx.user.create({
      data: {
        kuaishouId: application.kuaishouId,
        nickname: application.nickname,
        passwordHash: application.proposedPasswordHash,
        role: "MEMBER",
        active: true,
        guildStatus: application.guildStatus,
        boundPhoneEnc: application.boundPhoneEnc,
        account: { create: { balance: 0 } },
      },
    });
    await tx.guildStatusHistory.create({ data: { userId: user.id, status: application.guildStatus ?? "未设置", reason: "入团申请审核通过" } });
    await ensureNewMemberEligibility(tx, user);
    const updated = await tx.registrationApplication.update({
      where: { id: application.id },
      data: { status: "APPROVED", reviewedAt: now, reviewedById: input.reviewer.id, approvedUserId: user.id, proposedPasswordHash: null },
    });
    await writeAuditLog(tx, {
      actorId: input.reviewer.id,
      action: "REGISTRATION_APPLICATION_APPROVED",
      entity: "RegistrationApplication",
      entityId: application.id,
      afterValue: { kuaishouId: application.kuaishouId, status: updated.status, userId: user.id, accountBalance: 0 },
      ip: input.ip,
      requestId: input.requestId,
    });
    return { status: updated.status, applicationId: updated.id, userId: user.id, idempotent: false };
  });
}

export const registrationInternals = { isLinkAvailable, maskPhone, validateExpiresAt };

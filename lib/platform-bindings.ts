import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { stableAuthorUid } from "./video-author-evidence";

export class PlatformBindingError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export type VideoAuthorEvidence = {
  userId: string;
  sourceKind: string;
  fetchedAuthorUid: string | null;
  authorEvidenceVersion: number | null;
};

export function videoPlatform(sourceKind: string) {
  if (["douyin-short-link", "douyin-long-link", "douyin-share-text"].includes(sourceKind)) return "douyin";
  if (["short-link", "long-link", "share-text"].includes(sourceKind)) return "kuaishou";
  throw new PlatformBindingError("无法确认视频平台，请重新抓取作品");
}

async function lockMember(tx: Prisma.TransactionClient, userId: string, platform: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`platform-member:${userId}:${platform}`})::bigint)`;
}

async function lockAuthor(tx: Prisma.TransactionClient, platform: string, authorUid: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`platform-author:${platform}:${authorUid}`})::bigint)`;
}

async function requireActiveAdmin(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, active: true } });
  if (!actor?.active || actor.role !== "ADMIN") throw new PlatformBindingError("仅管理员可核验平台账号", 403);
}

function requireAuthorEvidence(video: VideoAuthorEvidence) {
  if (video.authorEvidenceVersion !== 1 || !stableAuthorUid(video.fetchedAuthorUid)) {
    throw new PlatformBindingError("未取得该作品可验证的作者 UID，请重新抓取；不能用昵称代替账号归属", 409);
  }
  return { platform: videoPlatform(video.sourceKind), authorUid: video.fetchedAuthorUid! };
}

/** Must run inside the same transaction as any video credit. Revocation shares this lock. */
export async function requireVerifiedVideoAuthor(tx: Prisma.TransactionClient, video: VideoAuthorEvidence) {
  const { platform, authorUid } = requireAuthorEvidence(video);
  await lockAuthor(tx, platform, authorUid);
  const binding = await tx.platformAccountBinding.findUnique({ where: { platform_authorUid: { platform, authorUid } } });
  if (!binding || binding.revokedAt || binding.userId !== video.userId) {
    throw new PlatformBindingError("该作品的作者账号尚未与您完成验证，请先在平台账号验证页面完成绑定", 409);
  }
  return binding;
}

export async function createPlatformBindingRequest(input: { userId: string; videoId: string; ip?: string }) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { active: true } });
    if (!user?.active) throw new PlatformBindingError("请先登录有效账号", 401);
    const video = await tx.videoSubmission.findUnique({ where: { id: input.videoId } });
    if (!video || video.userId !== input.userId) throw new PlatformBindingError("视频记录不存在", 404);
    const { platform, authorUid } = requireAuthorEvidence(video);
    if (!video.photoId || !video.metadataFetchedAt) throw new PlatformBindingError("请等待作品数据抓取完成", 409);
    await lockMember(tx, input.userId, platform);
    await lockAuthor(tx, platform, authorUid);
    const binding = await tx.platformAccountBinding.findUnique({ where: { platform_authorUid: { platform, authorUid } } });
    if (binding && binding.userId !== input.userId) throw new PlatformBindingError("该平台账号已被占用，请联系管理员核实", 409);
    const active = await tx.platformAccountBinding.findFirst({ where: { userId: input.userId, platform, revokedAt: null } });
    if (active) throw new PlatformBindingError(active.authorUid === authorUid ? "该平台账号已完成验证" : "此平台已有绑定，请联系管理员处理原绑定", 409);
    const pending = await tx.platformBindingRequest.findFirst({ where: { userId: input.userId, platform, status: "PENDING" } });
    const now = new Date();
    if (pending && pending.authorUid === authorUid && pending.expiresAt > now) return pending;
    if (pending) {
      await tx.platformBindingRequest.update({ where: { id: pending.id }, data: { status: "REJECTED", rejectionReason: "挑战过期或被新的验证申请替代", reviewedAt: now } });
      await tx.auditLog.create({ data: { actorId: input.userId, action: "PLATFORM_BINDING_REQUEST_REPLACED", entity: "PlatformBindingRequest", entityId: pending.id, reason: "挑战过期或被新的验证申请替代", ip: input.ip } });
    }
    const request = await tx.platformBindingRequest.create({ data: {
      userId: input.userId, platform, authorUid, videoId: video.id, photoId: video.photoId,
      challenge: `MM-${randomBytes(18).toString("base64url")}`, expiresAt: new Date(now.getTime() + 72 * 3600_000),
    } });
    await tx.auditLog.create({ data: { actorId: input.userId, action: "PLATFORM_BINDING_REQUESTED", entity: "PlatformBindingRequest", entityId: request.id, afterValue: { platform, authorUid, videoId: video.id, photoId: video.photoId, expiresAt: request.expiresAt.toISOString() }, ip: input.ip } });
    return request;
  });
}

type ReviewInput = {
  requestId: string; actorId: string; action: "approve" | "reject";
  challenge?: string; proofMethod?: "PLATFORM_MESSAGE" | "PROFILE_CHALLENGE";
  proofNote?: string; confirmedControl?: boolean; reason?: string; ip?: string;
};

export async function reviewPlatformBindingRequest(input: ReviewInput) {
  return db.$transaction(async (tx) => {
    await requireActiveAdmin(tx, input.actorId);
    const original = await tx.platformBindingRequest.findUnique({ where: { id: input.requestId } });
    if (!original) throw new PlatformBindingError("验证申请不存在", 404);
    if (original.userId === input.actorId) throw new PlatformBindingError("不能核验自己的平台账号", 403);
    await lockMember(tx, original.userId, original.platform);
    await lockAuthor(tx, original.platform, original.authorUid);
    const request = await tx.platformBindingRequest.findUniqueOrThrow({ where: { id: original.id } });
    const proofNote = input.proofNote?.trim() ?? "";
    const reason = input.reason?.trim() ?? "";
    if (request.status !== "PENDING") {
      const sameApproved = input.action === "approve" && request.status === "APPROVED" && request.reviewedById === input.actorId && request.proofMethod === input.proofMethod && request.proofNote === proofNote && input.challenge === request.challenge && input.confirmedControl === true;
      const sameRejected = input.action === "reject" && request.status === "REJECTED" && request.reviewedById === input.actorId && request.rejectionReason === reason;
      if (sameApproved || sameRejected) return request;
      throw new PlatformBindingError("验证申请已被处理，请刷新查看结果", 409);
    }
    if (input.action === "reject") {
      if (reason.length < 4 || reason.length > 1000) throw new PlatformBindingError("请填写 4 至 1000 字的驳回原因");
      const updated = await tx.platformBindingRequest.update({ where: { id: request.id }, data: { status: "REJECTED", rejectionReason: reason, reviewedAt: new Date(), reviewedById: input.actorId } });
      await tx.auditLog.create({ data: { actorId: input.actorId, action: "PLATFORM_BINDING_REJECTED", entity: "PlatformBindingRequest", entityId: request.id, reason, ip: input.ip } });
      return updated;
    }
    if (request.expiresAt <= new Date()) throw new PlatformBindingError("验证挑战已过期，请成员重新发起申请", 409);
    if (input.confirmedControl !== true || input.challenge !== request.challenge || !["PLATFORM_MESSAGE", "PROFILE_CHALLENGE"].includes(input.proofMethod ?? "") || proofNote.length < 20 || proofNote.length > 1000) {
      throw new PlatformBindingError("必须核对实际平台账号 UID、完整挑战码并记录账号控制权证据（20 至 1000 字）；公开主页或昵称不算验证");
    }
    const user = await tx.user.findUnique({ where: { id: request.userId }, select: { active: true } });
    if (!user?.active) throw new PlatformBindingError("成员账号已停用", 409);
    const video = await tx.videoSubmission.findUnique({ where: { id: request.videoId } });
    if (!video || video.userId !== request.userId || video.photoId !== request.photoId || video.fetchedAuthorUid !== request.authorUid || videoPlatform(video.sourceKind) !== request.platform || video.authorEvidenceVersion !== 1) {
      throw new PlatformBindingError("作品作者证据已变化，请重新发起验证", 409);
    }
    const existing = await tx.platformAccountBinding.findUnique({ where: { platform_authorUid: { platform: request.platform, authorUid: request.authorUid } } });
    if (existing && existing.userId !== request.userId) throw new PlatformBindingError("该平台账号已被其他成员绑定", 409);
    const active = await tx.platformAccountBinding.findFirst({ where: { userId: request.userId, platform: request.platform, revokedAt: null } });
    if (active) throw new PlatformBindingError("此平台已存在有效绑定，请先核实原绑定", 409);
    const now = new Date();
    const updated = await tx.platformBindingRequest.update({ where: { id: request.id }, data: { status: "APPROVED", reviewedAt: now, reviewedById: input.actorId, proofMethod: input.proofMethod, proofNote } });
    const binding = await tx.platformAccountBinding.upsert({
      where: { platform_authorUid: { platform: request.platform, authorUid: request.authorUid } },
      create: { userId: request.userId, platform: request.platform, authorUid: request.authorUid, requestId: request.id, verifiedById: input.actorId, verifiedAt: now },
      update: { revokedAt: null, requestId: request.id, verifiedById: input.actorId, verifiedAt: now },
    });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "PLATFORM_BINDING_VERIFIED", entity: "PlatformAccountBinding", entityId: binding.id, afterValue: { userId: binding.userId, platform: binding.platform, authorUid: binding.authorUid, requestId: request.id, proofMethod: input.proofMethod }, reason: "已核验平台 UID 与挑战码的账号控制权，详细证据见受限验证申请", ip: input.ip } });
    return updated;
  });
}

export async function revokePlatformBinding(input: { bindingId: string; actorId: string; reason: string; ip?: string }) {
  const reason = input.reason.trim();
  if (reason.length < 4 || reason.length > 1000) throw new PlatformBindingError("请填写 4 至 1000 字的撤销原因");
  return db.$transaction(async (tx) => {
    await requireActiveAdmin(tx, input.actorId);
    const binding = await tx.platformAccountBinding.findUnique({ where: { id: input.bindingId } });
    if (!binding) throw new PlatformBindingError("平台绑定不存在", 404);
    await lockMember(tx, binding.userId, binding.platform);
    await lockAuthor(tx, binding.platform, binding.authorUid);
    const current = await tx.platformAccountBinding.findUniqueOrThrow({ where: { id: binding.id } });
    if (current.revokedAt) {
      const prior = await tx.auditLog.findFirst({ where: { entity: "PlatformAccountBinding", entityId: binding.id, action: "PLATFORM_BINDING_REVOKED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      if (!prior || prior.actorId !== input.actorId || prior.reason !== reason) throw new PlatformBindingError("该绑定已被撤销，请刷新查看处理记录", 409);
      return current;
    }
    const claimed = await tx.platformAccountBinding.updateMany({ where: { id: binding.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (claimed.count) await tx.auditLog.create({ data: { actorId: input.actorId, action: "PLATFORM_BINDING_REVOKED", entity: "PlatformAccountBinding", entityId: binding.id, beforeValue: { platform: binding.platform, authorUid: binding.authorUid, userId: binding.userId }, reason, ip: input.ip } });
    return tx.platformAccountBinding.findUniqueOrThrow({ where: { id: binding.id } });
  });
}

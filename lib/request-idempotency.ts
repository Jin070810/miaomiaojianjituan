import { createHmac } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { normalizeVideoLink } from "./video-links";

export class IdempotencyConflictError extends Error {
  constructor() {
    super("该请求标识已被使用，且无法确认与本次申请一致，请先查看历史记录确认处理结果");
    this.name = "IdempotencyConflictError";
  }
}

export function assertTransferReplay(
  existing: { senderId: string; receiverId: string; amount: number; note: string | null },
  input: { senderId: string; receiverId: string; amount: number; note?: string },
) {
  if (existing.senderId !== input.senderId || existing.receiverId !== input.receiverId
    || existing.amount !== input.amount || (existing.note?.trim() || "") !== (input.note?.trim() || "")) {
    throw new IdempotencyConflictError();
  }
}

export function assertVideoReplay(existing: { userId: string; sourceUrl: string }, userId: string, requestUrl: string) {
  if (existing.userId !== userId) throw new IdempotencyConflictError();
  // The worker may replace requestUrl after resolving a short link. sourceUrl
  // retains the submitted link/text and is the immutable comparison source.
  let originalUrl: string;
  try { originalUrl = normalizeVideoLink(existing.sourceUrl).requestUrl; }
  catch { throw new IdempotencyConflictError(); }
  if (originalUrl !== requestUrl) throw new IdempotencyConflictError();
}

function canonical(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

// Store only a keyed digest in the existing transactional audit event. Raw
// recipient details/QRs never enter audit JSON. Changing the encryption key
// requires a coordinated data/key migration, as for existing encrypted fields.
export function requestFingerprint(scope: string, payload: object) {
  const key = Buffer.from(process.env.PHONE_ENCRYPTION_KEY ?? "", "hex");
  if (key.length !== 32) throw new Error("PHONE_ENCRYPTION_KEY配置无效");
  return `v1:${createHmac("sha256", key).update(`${scope}\n${JSON.stringify(canonical(payload))}`).digest("hex")}`;
}

export async function assertAuditRequestReplay(
  tx: Pick<Prisma.TransactionClient, "auditLog">,
  where: Prisma.AuditLogWhereInput,
  fingerprint: string,
) {
  const audit = await tx.auditLog.findFirst({ where, select: { afterValue: true }, orderBy: { createdAt: "asc" } });
  const value = audit?.afterValue;
  if (!value || Array.isArray(value) || typeof value !== "object" || value.requestFingerprint !== fingerprint) {
    // Legacy records have no original-request digest. Fail closed instead of
    // guessing from a profile that may have changed since submission.
    throw new IdempotencyConflictError();
  }
}

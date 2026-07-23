import crypto from "node:crypto";
import argon2 from "argon2";
import { NextResponse } from "next/server";
import { RateLimitError } from "./rate-limit";

export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function requestId() {
  return crypto.randomUUID();
}

export function getClientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
}

export function requireIdempotency(request: Request) {
  const value = request.headers.get("idempotency-key")?.trim();
  if (!value || value.length > 120) throw new Error("缺少有效的幂等请求标识");
  return value;
}

export const MAX_CASH_QR_CODE_LENGTH = 3_000_000;

export function isSafeCashQrCodeUrl(value: string) {
  return /^https:\/\//i.test(value) || /^data:image\/(?:png|jpeg|webp);base64,/i.test(value);
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new Error("跨站请求已拒绝");
}

export function encryptSensitive(value: string) {
  const key = Buffer.from(process.env.PHONE_ENCRYPTION_KEY ?? "", "hex");
  if (key.length !== 32) throw new Error("PHONE_ENCRYPTION_KEY必须是32字节十六进制密钥");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSensitive(value: string) {
  const key = Buffer.from(process.env.PHONE_ENCRYPTION_KEY ?? "", "hex");
  if (key.length !== 32) throw new Error("PHONE_ENCRYPTION_KEY配置无效");
  const [ivText, tagText, dataText] = value.split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}

export const encryptPhone = encryptSensitive;
export const decryptPhone = decryptSensitive;

export function rateLimitResponse(error: unknown) {
  if (!(error instanceof RateLimitError)) return null;
  return NextResponse.json(
    { error: error.message },
    { status: 429, headers: { "retry-after": String(error.retryAfter) } },
  );
}

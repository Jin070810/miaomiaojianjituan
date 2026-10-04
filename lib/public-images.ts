import { createHash } from "node:crypto";

const PREFIX = "data:image/webp;base64,";
export const MAX_PUBLIC_IMAGE_BYTES = 120 * 1024;
export type PublicImageKind = "gift" | "avatar";

function inlineWebp(value: string) {
  return value.length <= PREFIX.length + Math.ceil(MAX_PUBLIC_IMAGE_BYTES / 3) * 4 && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function publicImageVersion(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function publicImageUrl(kind: PublicImageKind, id: string, value: string | null | undefined) {
  if (!value) return null;
  if (!value.startsWith("data:")) return value;
  if (!inlineWebp(value)) return null;
  return `/api/public-images/${kind}/${encodeURIComponent(id)}/${publicImageVersion(value)}.webp`;
}

export function publicAvatarUrl(user: { id: string; avatarUrl: string | null }) { return publicImageUrl("avatar", user.id, user.avatarUrl); }
export function withPublicGiftImage<T extends { id: string; imageUrl: string | null }>(gift: T): T {
  return { ...gift, imageUrl: publicImageUrl("gift", gift.id, gift.imageUrl) };
}

export function publicImageBytes(value: string, expectedVersion: string) {
  if (!inlineWebp(value) || publicImageVersion(value) !== expectedVersion) return null;
  const base64 = value.slice(PREFIX.length);
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 12 || bytes.length > MAX_PUBLIC_IMAGE_BYTES || bytes.toString("base64") !== base64 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
  return bytes;
}

import { db } from "@/lib/db";
import { publicImageBytes } from "@/lib/public-images";

type Context = { params: Promise<{ kind: string; id: string; version: string }> };
const unavailable = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, context: Context) {
  const { kind, id, version } = await context.params;
  if (!["gift", "avatar"].includes(kind) || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || !/^[a-f0-9]{64}\.webp$/.test(version)) return unavailable();
  // Explicit allowlist: no order, payment QR, recipient field or arbitrary URL lookup.
  const value = kind === "gift"
    ? (await db.gift.findFirst({ where: { id, deletedAt: null }, select: { imageUrl: true } }))?.imageUrl
    : (await db.user.findFirst({ where: { id, active: true }, select: { avatarUrl: true } }))?.avatarUrl;
  if (!value) return unavailable();
  const hash = version.slice(0, -5);
  const bytes = publicImageBytes(value, hash);
  if (!bytes) return unavailable();
  const etag = `"${hash}"`;
  const headers = {
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Type": "image/webp",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    ETag: etag,
  };
  const matches = request.headers.get("if-none-match")?.split(",").some((value) => value.trim().replace(/^W\//, "") === etag || value.trim() === "*");
  if (matches) return new Response(null, { status: 304, headers });
  return new Response(Uint8Array.from(bytes), { headers: { ...headers, "Content-Length": String(bytes.length) } });
}

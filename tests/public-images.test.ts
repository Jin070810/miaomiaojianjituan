import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { publicAvatarUrl, publicImageBytes, publicImageUrl, publicImageVersion, withPublicGiftImage } from "@/lib/public-images";

const lookups = vi.hoisted(() => ({ gift: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { gift: { findFirst: lookups.gift }, user: { findFirst: lookups.user } } }));
import { GET } from "@/app/api/public-images/[kind]/[id]/[version]/route";

describe("versioned public image boundary", () => {
  let inline: string;
  let bytes: Buffer;
  beforeAll(async () => {
    bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#123456" } }).webp().toBuffer();
    inline = `data:image/webp;base64,${bytes.toString("base64")}`;
  });
  const context = (kind: string, version: string, id = "fixture") => ({ params: Promise.resolve({ kind, id, version }) });
  it("returns stable content versions without changing stored values or existing image URLs", () => {
    const user = { id: "fixture", avatarUrl: inline };
    expect(publicAvatarUrl(user)).toBe(`/api/public-images/avatar/fixture/${publicImageVersion(inline)}.webp`);
    expect(withPublicGiftImage({ id: "fixture", imageUrl: inline, name: "礼品" })).toMatchObject({ name: "礼品", imageUrl: expect.stringMatching(/^\/api\/public-images\/gift\//) });
    expect(user.avatarUrl).toBe(inline);
    expect(publicImageUrl("gift", "fixture", "/gifts/import.webp")).toBe("/gifts/import.webp");
    expect(publicAvatarUrl({ id: "fixture", avatarUrl: null })).toBeNull();
  });
  it("serves exact WebP bytes with independent immutable caching and conditional responses", async () => {
    lookups.gift.mockResolvedValue({ imageUrl: inline });
    const version = `${publicImageVersion(inline)}.webp`;
    const response = await GET(new Request("https://example.test/"), context("gift", version));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const cached = await GET(new Request("https://example.test/", { headers: { "if-none-match": `W/${response.headers.get("etag")}` } }), context("gift", version));
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
    expect(lookups.gift).toHaveBeenCalledWith({ where: { id: "fixture", deletedAt: null }, select: { imageUrl: true } });
  });
  it("never returns changed content under an old version, and does not cache misses", async () => {
    lookups.gift.mockResolvedValue({ imageUrl: inline });
    const response = await GET(new Request("https://example.test/"), context("gift", `${"0".repeat(64)}.webp`));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    lookups.gift.mockResolvedValue(null);
    expect((await GET(new Request("https://example.test/"), context("gift", `${publicImageVersion(inline)}.webp`))).status).toBe(404);
  });
  it("rejects private image kinds, paths and arbitrary remote URLs before any lookup", async () => {
    for (const kind of ["cashQrCodeUrl", "order", "recipient", "https://example.test"]) expect((await GET(new Request("https://example.test/"), context(kind, `${publicImageVersion(inline)}.webp`))).status).toBe(404);
    expect((await GET(new Request("https://example.test/"), context("gift", `${publicImageVersion(inline)}.webp`, "../private"))).status).toBe(404);
    expect(lookups.gift).not.toHaveBeenCalled();
    expect(lookups.user).not.toHaveBeenCalled();
  });
  it("reads only active user avatar fields and never follows stored URLs", async () => {
    lookups.user.mockResolvedValue({ avatarUrl: inline });
    expect((await GET(new Request("https://example.test/"), context("avatar", `${publicImageVersion(inline)}.webp`))).status).toBe(200);
    expect(lookups.user).toHaveBeenCalledWith({ where: { id: "fixture", active: true }, select: { avatarUrl: true } });
    lookups.user.mockResolvedValue({ avatarUrl: "https://127.0.0.1/private" });
    expect((await GET(new Request("https://example.test/"), context("avatar", `${publicImageVersion(inline)}.webp`))).status).toBe(404);
  });
  it("rejects SVG, oversized, corrupted, and noncanonical payloads", () => {
    for (const value of ["data:image/svg+xml;base64,PHN2Zy8+", "data:image/webp;base64," + Buffer.from("not-webp").toString("base64"), "data:image/webp;base64," + "A".repeat(170000)]) expect(publicImageBytes(value, publicImageVersion(value))).toBeNull();
    expect(publicImageBytes(inline, publicImageVersion(inline))).toEqual(bytes);
    const truncated = inline.slice(0, -4);
    expect(publicImageBytes(truncated, publicImageVersion(truncated))).toBeNull();
    expect(publicImageBytes(inline + "=", publicImageVersion(inline + "="))).toBeNull();
  });
});

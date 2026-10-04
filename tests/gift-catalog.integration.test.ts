import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET } from "@/app/api/gifts/route";

const suite = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
suite("public gift catalogue", () => {
  const token = randomUUID();
  const category = `catalog-${token.slice(0, 8)}`;
  const otherCategory = `other-${token.slice(0, 8)}`;
  const ids = Array.from({ length: 5 }, (_, index) => `catalog-${token}-${index}`);
  const userId = `catalog-user-${token}`;
  let inlineImage: string;
  beforeAll(async () => {
    inlineImage = `data:image/webp;base64,${(await sharp({ create: { width: 16, height: 16, channels: 3, background: "#ff7700" } }).webp().toBuffer()).toString("base64")}`;
    await db.user.create({ data: { id: userId, kuaishouId: userId, nickname: "合成商品验收", passwordHash: "fixture-unused" } });
    await db.gift.createMany({ data: ids.map((id, index) => ({ id, name: `合成礼品 ${index}`, category: index === 4 ? otherCategory : category, pointsCost: (index + 1) * 10, stock: 5, active: index !== 3, pinned: index === 0, displayOrder: index, imageUrl: inlineImage })) });
    await db.redemptionOrder.createMany({ data: [
      { userId, giftId: ids[0], quantity: 1, unitCost: 10, totalCost: 10, status: "FULFILLED", idempotencyKey: `${token}-one` },
      { userId, giftId: ids[1], quantity: 3, unitCost: 20, totalCost: 60, status: "PENDING", idempotencyKey: `${token}-three` },
      { userId, giftId: ids[2], quantity: 20, unitCost: 30, totalCost: 600, status: "REFUNDED", idempotencyKey: `${token}-refund` },
    ] });
  });
  afterAll(async () => {
    await db.redemptionOrder.deleteMany({ where: { userId } });
    await db.gift.deleteMany({ where: { id: { in: ids } } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });
  async function catalog(query: string) {
    const response = await GET(new Request(`https://example.test/api/gifts?${query}`));
    expect(response.status).toBe(200);
    return response.json();
  }
  it("filters and pages before returning image data, retaining categories outside the current page", async () => {
    const first = await catalog(`page=1&take=2&category=${category}`);
    const second = await catalog(`page=2&take=2&category=${category}`);
    expect(first.gifts.map((gift: { id: string }) => gift.id)).toEqual(ids.slice(0, 2));
    expect(second.gifts.map((gift: { id: string }) => gift.id)).toEqual([ids[2]]);
    expect(first.pagination).toEqual({ page: 1, take: 2, total: 3, pages: 2 });
    expect(first.categories).toContain(otherCategory);
    expect(JSON.stringify(first)).not.toContain("data:image/");
    expect(first.gifts[0].imageUrl).toMatch(/^\/api\/public-images\/gift\/.+\/[a-f0-9]{64}\.webp$/);
    expect((await db.gift.findUniqueOrThrow({ where: { id: ids[0] } })).imageUrl).toBe(inlineImage);
  });
  it("sorts across the whole category, counts only non-refunded sales, and keeps stable page ties", async () => {
    expect((await catalog(`page=1&take=1&category=${category}&sort=priceDesc`)).gifts[0].id).toBe(ids[2]);
    const sales = await catalog(`page=1&take=2&category=${category}&sort=sales`);
    expect(sales.gifts.map((gift: { id: string; salesCount: number }) => [gift.id, gift.salesCount])).toEqual([[ids[1], 3], [ids[0], 1]]);
    expect((await catalog(`page=2&take=2&category=${category}&sort=sales`)).gifts[0]).toMatchObject({ id: ids[2], salesCount: 0 });
  });
  it("rejects invalid pagination/sort values and keeps the old unpaged response usable", async () => {
    for (const query of ["page=Infinity", "take=100000", "sort=unknown", "page=-1"]) expect((await GET(new Request(`https://example.test/api/gifts?${query}`))).status).toBe(400);
    const legacy = await (await GET(new Request("https://example.test/api/gifts"))).json();
    expect(legacy.gifts.filter((gift: { id: string }) => ids.includes(gift.id))).toHaveLength(4);
    expect(JSON.stringify(legacy)).not.toContain(inlineImage);
    expect((await catalog(`page=100&take=2&category=${category}`)).gifts).toEqual([]);
  });
});

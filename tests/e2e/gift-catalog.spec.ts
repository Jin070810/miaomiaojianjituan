import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { db } from "@/lib/db";
import { cleanupWeeklyChallengeE2E, e2eIds, expectNoHorizontalOverflow, login, seedWeeklyChallengeE2E } from "./weekly-challenge-fixture";

const prefix = `catalog-e2e-${randomUUID()}`;
let inlineImage: string;
const evidenceDirectory = path.join(process.env.PLAYWRIGHT_EVIDENCE_DIR ?? os.tmpdir(), "miaomiao-gift-catalog");
test.beforeAll(async () => {
  await seedWeeklyChallengeE2E();
  const image = await sharp(randomBytes(256 * 256 * 3), { raw: { width: 256, height: 256, channels: 3 } }).webp({ quality: 55 }).toBuffer();
  inlineImage = `data:image/webp;base64,${image.toString("base64")}`;
  await db.gift.createMany({ data: Array.from({ length: 31 }, (_, index) => ({ id: `${prefix}-${index}`, name: `缓存验收礼品 ${String(index).padStart(2, "0")}`, kind: index === 30 ? "MEMBERSHIP" : "PHYSICAL", category: index === 30 ? "分页另一类" : "缓存验收", pointsCost: index === 29 ? 20000 : 100 + index, stock: index === 0 ? 0 : 5, pinned: true, displayOrder: index - 10000, imageUrl: inlineImage })) });
  await db.user.update({ where: { kuaishouId: e2eIds.noTaskMember }, data: { avatarUrl: inlineImage } });
  await fs.mkdir(evidenceDirectory, { recursive: true });
});
test.afterAll(async () => {
  await db.redemptionOrder.deleteMany({ where: { giftId: { startsWith: prefix } } });
  await db.gift.deleteMany({ where: { id: { startsWith: prefix } } });
  await cleanupWeeklyChallengeE2E();
  await db.$disconnect();
});
test.beforeEach(async () => {
  // Isolate catalogue checks from the preceding redemption's unread popup.
  const member = await db.user.findUniqueOrThrow({ where: { kuaishouId: e2eIds.noTaskMember }, select: { id: true } });
  await db.notification.updateMany({ where: { userId: member.id }, data: { readAt: new Date() } });
});

test("gift pages retain global filters, recover failed loads and deliver independently cached images", async ({ page, browser }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, e2eIds.noTaskMember);
  await page.getByRole("navigation", { name: "成员导航" }).getByRole("button", { name: "礼物", exact: true }).click();
  await page.getByRole("button", { name: "缓存验收", exact: true }).click();
  const cards = page.locator(".journal-gift-card");
  await expect(cards).toHaveCount(24);
  await expect(page.getByText("已显示 24 / 30 件礼品", { exact: true })).toBeVisible();
  await expect(cards.first().getByRole("button", { name: "已售罄" })).toBeDisabled();
  const imageUrl = await cards.first().locator("img").getAttribute("src");
  expect(imageUrl).toMatch(/^\/api\/public-images\/gift\//);
  const publicContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const response = await publicContext.request.get(imageUrl!);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("immutable");
    expect((await publicContext.request.get(imageUrl!, { headers: { "if-none-match": response.headers().etag } })).status()).toBe(304);
    expect((await publicContext.request.get(imageUrl!.replace("/gift/", "/cashQrCodeUrl/"))).status()).toBe(404);
    const avatarUrl = await page.locator(".member-topbar .avatar img").getAttribute("src");
    expect(avatarUrl).toMatch(/^\/api\/public-images\/avatar\//);
    expect((await publicContext.request.get(avatarUrl!)).status()).toBe(200);
  } finally { await publicContext.close(); }
  let pageTwoAttempts = 0;
  await page.route((url) => url.pathname === "/api/gifts" && url.searchParams.get("page") === "2", async (route) => {
    if (++pageTwoAttempts === 1) await route.fulfill({ status: 503, json: { error: "合成网络故障" } });
    else await route.continue();
  });
  await page.getByRole("button", { name: "加载更多礼品" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "合成网络故障" })).toBeVisible();
  await expect(cards).toHaveCount(24);
  await page.getByRole("button", { name: "重新加载礼品" }).click();
  await expect(cards).toHaveCount(30);
  await expect(page.getByRole("button", { name: "加载更多礼品" })).toHaveCount(0);
  await page.getByRole("button", { name: "价格降序", exact: true }).click();
  await expect(cards.first().getByRole("heading")).toHaveText("缓存验收礼品 29");
  await expect(cards.first().getByRole("button")).toBeDisabled();
  await page.getByRole("button", { name: "分页另一类", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByRole("heading")).toHaveText("缓存验收礼品 30");
  await cards.first().getByRole("button", { name: "查看" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "确认兑换" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "确认兑换", exact: true }).click();
  await expect(page.getByRole("heading", { name: "兑换成功啦" })).toBeVisible();
  await page.getByRole("button", { name: "查看兑换记录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "兑换记录", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("navigation", { name: "成员导航" }).getByRole("button", { name: "礼物", exact: true }).click();
  await page.getByRole("button", { name: "分页另一类", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByText("剩 4 · 已兑 1", { exact: true })).toBeVisible();
  await expect(page.locator(".mall-points strong")).toHaveText("9,870");
  await page.locator(".mall-journal-hero").getByRole("button", { name: "兑换记录" }).click();
  await expect(page.getByRole("heading", { name: "兑换记录", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("navigation", { name: "成员导航" }).getByRole("button", { name: "礼物", exact: true }).click();
  await page.getByRole("button", { name: "分页另一类", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(evidenceDirectory, `catalog-${testInfo.project.name}.png`), fullPage: true });
  const raw = await db.gift.findMany({ where: { active: true, deletedAt: null } });
  const sales = await db.redemptionOrder.groupBy({ by: ["giftId"], where: { status: { notIn: ["REJECTED", "REFUNDED"] } }, _sum: { quantity: true } });
  const salesById = new Map(sales.map((row) => [row.giftId, row._sum.quantity ?? 0]));
  const after = await page.request.get("/api/gifts");
  const afterBytes = (await after.body()).length;
  const beforeBytes = Buffer.byteLength(JSON.stringify({ gifts: raw.map((gift) => ({ ...gift, salesCount: salesById.get(gift.id) ?? 0 })) }));
  expect(afterBytes).toBeLessThan(beforeBytes / 4);
  await fs.writeFile(path.join(evidenceDirectory, `payload-${testInfo.project.name}.json`), JSON.stringify({ source: "synthetic fixture; raw JSON bytes, not production wire/LCP", gifts: raw.length, inlineImageBytes: inlineImage.length, beforeBytes, afterBytes }, null, 2));
  expect(errors).toEqual([]);
});

test("catalog shows loading, error, retry, empty and legacy response states", async ({ page }, testInfo) => {
  await login(page, e2eIds.noTaskMember);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let attempts = 0;
  await page.route((url) => url.pathname === "/api/gifts", async (route) => {
    attempts += 1;
    if (attempts === 1) { await gate; await route.fulfill({ status: 503, json: { error: "合成加载失败" } }); }
    else if (attempts === 2) await route.fulfill({ json: { gifts: [], categories: [], pagination: { page: 1, pages: 1, total: 0 } } });
    else await route.fulfill({ json: { gifts: [{ id: "legacy", name: "兼容旧响应礼品", category: "实用好物", pointsCost: 100, stock: 0, kind: "PHYSICAL", imageUrl: null, tags: [] }] } });
  });
  const navigation = page.getByRole("navigation", { name: "成员导航" });
  await navigation.getByRole("button", { name: "礼物", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "正在加载礼品" })).toBeVisible();
  release();
  await expect(page.getByRole("alert").filter({ hasText: "合成加载失败" })).toBeVisible();
  await page.getByRole("button", { name: "重新加载礼品" }).click();
  await expect(page.getByText("礼物屋正在补货，晚点再来看看吧", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(evidenceDirectory, `catalog-empty-${testInfo.project.name}.png`), fullPage: true });
  await navigation.getByRole("button", { name: "我的", exact: true }).click();
  await navigation.getByRole("button", { name: "礼物", exact: true }).click();
  await expect(page.getByRole("heading", { name: "兼容旧响应礼品" })).toBeVisible();
  await expect(page.getByRole("button", { name: "已售罄" })).toBeDisabled();
  await expectNoHorizontalOverflow(page);
});

import { expect, test, type Page } from "@playwright/test";
import argon2 from "argon2";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/lib/db";
import { e2ePassword, expectNoHorizontalOverflow, login } from "./weekly-challenge-fixture";

const memberId = "loading-e2e-member";

async function cleanup() {
  const member = await db.user.findUnique({ where: { kuaishouId: memberId }, select: { id: true } });
  if (!member) return;
  await db.auditLog.deleteMany({ where: { actorId: member.id } });
  await db.user.delete({ where: { id: member.id } });
}

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("schema=")) throw new Error("E2E 需要显式测试 schema");
  await cleanup();
  await db.user.create({ data: { kuaishouId: memberId, nickname: "加载验收成员", role: "MEMBER", passwordHash: await argon2.hash(e2ePassword), account: { create: { balance: 0 } } } });
});

test.afterAll(async () => { await cleanup(); await db.$disconnect(); });

async function screenshot(page: Page, name: string) {
  const directory = process.env.PLAYWRIGHT_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${name}-${page.viewportSize()?.width}.png`), fullPage: false });
}

test("cold login and home omit fonts and unopened view chunks; lazy views recover from API errors", async ({ page }) => {
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  const scripts: Array<Promise<string>> = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("503 (Service Unavailable)")) consoleErrors.push(message.text());
  });
  page.on("request", (request) => requests.push(request.url()));
  page.on("response", (response) => {
    if (response.request().resourceType() === "script" && response.ok()) scripts.push(response.text().catch(() => ""));
  });

  let releaseHome!: () => void;
  const homeGate = new Promise<void>((resolve) => { releaseHome = resolve; });
  await page.route("**/api/member/home", async (route) => { const response = await route.fetch(); await homeGate; await route.fulfill({ response }); });
  await login(page, memberId);
  await expect(page).toHaveTitle("妙妙剪辑团积分中心");
  await expect(page).toHaveURL(/\/$/);
  // A cold session must not trigger the expensive achievements read before the
  // home card can be displayed. Critical home/growth/challenge reads stay parallel.
  await expect.poll(() => requests.some((url) => url.endsWith("/api/member/home"))).toBe(true);
  expect(requests.some((url) => url.endsWith("/api/member/achievements"))).toBe(false);
  releaseHome();
  await expect(page.getByRole("button", { name: "提交切片", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "本周成长", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await screenshot(page, "loading-home");
  const initialScripts = (await Promise.all(scripts)).join("\n");
  expect(requests.filter((url) => /\.(woff2?|ttf)(\?|$)/.test(url))).toEqual([]);
  expect(initialScripts).not.toContain("生日资料加载失败");
  expect(initialScripts).not.toContain("成长经验独立累计");
  expect(initialScripts).not.toContain("这里暂时没有兑换记录");

  // Hold the actual async birthday chunk, so the loading state is verified
  // independently of API latency and does not depend on a generated chunk hash.
  let releaseChunk!: () => void;
  const chunkGate = new Promise<void>((resolve) => { releaseChunk = resolve; });
  let heldChunk = false;
  await page.route("**/_next/static/chunks/*.js", async (route) => {
    const response = await route.fetch();
    if ((await response.text()).includes("生日资料加载失败")) { heldChunk = true; await chunkGate; }
    await route.fulfill({ response });
  });
  let birthdayFails = true;
  await page.route("**/api/birthdays/me", (route) => route.fulfill({ status: birthdayFails ? 503 : 200, json: birthdayFails ? { error: "模拟生日加载失败" } : { profile: { birthday: null, pendingBirthday: null, pendingEffectiveAt: null, visibleOnWall: false, onboardingSeenAt: new Date().toISOString(), nextSelfChangeAt: null }, benefits: [], wishes: [], presets: [] } }));
  await page.route("**/api/birthdays/wall", (route) => route.fulfill({ json: { today: [], wishable: [], upcoming: [], presets: [] } }));
  await page.getByRole("button", { name: "进入生日星愿" }).click();
  await expect.poll(() => heldChunk).toBe(true);
  await expect(page.getByRole("status")).toContainText("正在打开页面");
  await screenshot(page, "loading-view-wait");
  releaseChunk();
  await expect(page.getByText("模拟生日加载失败")).toBeVisible();
  birthdayFails = false;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByRole("heading", { name: "把今天的好心情装进礼物里" })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存生日资料" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "生日当天开放" })).toBeDisabled();
  await expect(page.getByText("未来 30 天暂无公开生日。")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await screenshot(page, "loading-birthday-empty");
  await page.getByRole("button", { name: "返回首页" }).click();

  await page.getByRole("button", { name: "查看成长与成就" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "查看成长与成就" }).click();
  await expect(page.getByRole("heading", { name: "勋章墙" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await screenshot(page, "loading-achievements");
  await page.getByRole("button", { name: "返回首页" }).click();
  for (const [button, heading, empty] of [
    ["积分记录", "积分记录", "这里暂时没有记录"],
    ["送积分记录", "送积分记录", "这里暂时没有送积分记录"],
    ["兑换记录", "兑换记录", "这里暂时没有兑换记录"],
  ]) {
    await page.getByRole("navigation").getByRole("button", { name: "我的", exact: true }).click();
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByText(empty, { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "返回", exact: true }).click();
  }
  expect(errors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("a failed view chunk leaves navigation and reload available", async ({ page }) => {
  await login(page, memberId);
  await expect(page.getByRole("button", { name: "提交切片", exact: true }).first()).toBeVisible();
  await page.route("**/_next/static/chunks/*.js", async (route) => {
    const response = await route.fetch();
    if ((await response.text()).includes("生日资料加载失败")) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "进入生日星愿" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "页面资源暂时没有加载成功" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新加载页面" })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
  await screenshot(page, "loading-chunk-error");
  await page.getByRole("button", { name: "返回首页" }).click();
  await expect(page.getByRole("button", { name: "提交切片", exact: true }).first()).toBeVisible();
});

import { expect, test, type Page } from "@playwright/test";
import argon2 from "argon2";
import { db } from "@/lib/db";
import { claimRankingAward, periodBounds, settleRankingPeriod } from "@/lib/rankings";
import { revokeVideoReward } from "@/lib/points";
import { e2ePassword, expectElementsWithinViewport, expectNoHorizontalOverflow, login } from "./weekly-challenge-fixture";

const prefix = "ranking-policy-e2e-";
const ids = { admin: `${prefix}admin`, member: `${prefix}member`, paid: `${prefix}paid`, cancel: `${prefix}cancel`, reviewer: `${prefix}reviewer` };
const periodId = `${prefix}period`;
const giftId = `${prefix}gift`;
let awards: { member: string; paid: string; cancel: string };

async function cleanup() {
  await db.notification.deleteMany({ where: { dedupeKey: { startsWith: `ranking:${periodId}:` } } });
  await db.rankingPeriod.deleteMany({ where: { id: periodId } });
  await db.auditLog.deleteMany({ where: { actor: { kuaishouId: { startsWith: prefix } } } });
  await db.user.deleteMany({ where: { kuaishouId: { startsWith: prefix } } });
  await db.gift.deleteMany({ where: { id: giftId } });
}

test.beforeEach(async () => {
  if (!process.env.DATABASE_URL?.includes("schema=")) throw new Error("E2E 必须使用隔离测试数据库");
  await cleanup();
  const passwordHash = await argon2.hash(e2ePassword);
  const users = await Promise.all(Object.entries(ids).map(([key, kuaishouId]) => db.user.create({ data: {
    kuaishouId, nickname: key === "member" ? "冻结测试成员" : key === "paid" ? "已发测试成员" : key === "cancel" ? "取消测试成员" : key === "reviewer" ? "测试审核员" : "榜单测试管理员",
    passwordHash, role: key === "admin" ? "ADMIN" : key === "reviewer" ? "REVIEWER" : "MEMBER", account: { create: { balance: 0 } },
  } })));
  const byKey = new Map(users.map((user) => [user.kuaishouId, user]));
  const bounds = periodBounds("week", new Date("2039-02-15T00:00:00Z"));
  await db.rankingPeriod.create({ data: { id: periodId, type: "WEEK", periodStart: bounds.start, periodEnd: bounds.end } });
  const videos = await Promise.all(["member", "paid", "cancel"].map((key, index) => {
    const user = byKey.get(ids[key as keyof typeof ids])!;
    return db.videoSubmission.create({ data: { userId: user.id, sourceUrl: "https://v.kuaishou.com/e2e-ranking-policy", requestUrl: "https://v.kuaishou.com/e2e-ranking-policy", sourceKind: "short-link", submittedNickname: user.nickname, idempotencyKey: crypto.randomUUID(), status: "APPROVED", likes: 3000 - index * 1000, submittedAt: new Date(bounds.start.getTime() + 60_000) } });
  }));
  const actorId = byKey.get(ids.admin)!.id;
  await settleRankingPeriod({ type: "week", periodStart: bounds.start, settledAt: bounds.end, actorId, rewards: [1, 2, 3].map((rank) => ({ rank, title: `测试第${rank}名奖励` })) });
  const rows = await db.rankingAward.findMany({ where: { periodId }, orderBy: { rank: "asc" } });
  awards = { member: rows[0].id, paid: rows[1].id, cancel: rows[2].id };
  for (const key of ["paid", "cancel"] as const) await claimRankingAward({ awardId: awards[key], userId: byKey.get(ids[key])!.id, recipientName: "测试收货人", phone: "13800000000", address: "仅用于测试的虚拟收货地址" });
  await db.rankingAward.update({ where: { id: awards.paid }, data: { status: "FULFILLED", fulfilledAt: new Date() } });
  await db.gift.create({ data: { id: giftId, name: "榜单测试库存", kind: "PHYSICAL", pointsCost: 100, stock: 4 } });
  await db.rankingAward.update({ where: { id: awards.cancel }, data: { giftId } });
  for (const video of videos) await revokeVideoReward({ videoId: video.id, actorId, reason: "测试撤销：贡献视频不符合规则" });
  // Notifications have separate coverage; keep their automatic prompt from
  // obscuring the award state under test in either viewport.
  await db.notification.updateMany({ where: { userId: { in: users.map((user) => user.id) } }, data: { readAt: new Date() } });
});

test.afterEach(async ({ page }) => { await page.goto("about:blank"); await cleanup(); });
test.afterAll(() => db.$disconnect());

async function openRankings(page: Page) {
  await expect(page.getByRole("heading", { name: "运营工作台" })).toBeVisible();
  if (page.viewportSize()!.width < 800) {
    await page.getByRole("button", { name: "打开菜单" }).click();
    await page.getByRole("navigation", { name: "管理后台导航" }).getByRole("button", { name: "榜单结算", exact: true }).click();
  } else await page.locator(".admin-sidebar").getByRole("button", { name: "榜单结算", exact: true }).click();
  await expect(page.getByRole("heading", { name: "榜单结算", exact: true })).toBeVisible();
}

async function fillResolution(page: Page, note: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "保存处理结果" })).toBeDisabled();
  await dialog.getByLabel("处理依据（5 至 1000 字）").fill(note);
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole("button", { name: "保存处理结果" }).click();
}

test("admin resolves unpaid and paid tasks with loading, failure, empty and stock-safe outcomes", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, ids.admin);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/admin/rankings/adjustments?*", async (route) => { await gate; await route.fulfill({ status: 503, json: { error: "测试读取失败，请刷新重试" } }); });
  await openRankings(page);
  const panel = page.getByRole("region", { name: "撤销关联奖励待办" });
  await expect(panel.getByText("正在读取榜单调整待办…")).toBeVisible();
  await expect(panel.getByRole("button", { name: "刷新待办" })).toBeDisabled();
  release();
  await expect(panel.getByRole("alert")).toHaveText("测试读取失败，请刷新重试");
  await page.unroute("**/api/admin/rankings/adjustments?*");
  await panel.getByRole("button", { name: "刷新待办" }).click();
  await expect(panel.locator("article")).toHaveCount(3);
  await expectElementsWithinViewport(page, ".ranking-adjustment-panel, .ranking-adjustment-card, .ranking-adjustment-actions button");
  expect(await panel.locator(".ranking-adjustment-actions button").evaluateAll((buttons) => buttons.every((button) => button.getBoundingClientRect().height >= 44))).toBe(true);
  await page.screenshot({ path: `output/playwright/ranking-pending-${testInfo.project.name}.png`, fullPage: true });
  const period = page.locator("section.admin-panel").filter({ hasText: "2039" }).filter({ has: page.getByRole("heading", { name: "周更新排行榜" }) }).first();
  if (await period.getByRole("button", { name: "展开榜单周期" }).count()) await period.getByRole("button", { name: "展开榜单周期" }).click();
  await expect(period.getByRole("button", { name: "冻结中" })).toBeDisabled();

  const paid = panel.getByRole("article", { name: "已发测试成员的榜单调整" });
  await page.route("**/api/admin/rankings/adjustments/*", (route) => route.fulfill({ status: 503, json: { error: "测试保存失败，请重试" } }), { times: 1 });
  await paid.getByRole("button", { name: "确认无需调整" }).click();
  await fillResolution(page, "已核实奖励依据，保留已发奖励");
  await expect(panel.getByRole("alert")).toHaveText("测试保存失败，请重试");
  await panel.getByRole("button", { name: "刷新待办" }).click();
  await expect(paid).toBeVisible();
  let finishPatch!: () => void;
  const patchGate = new Promise<void>((resolve) => { finishPatch = resolve; });
  await page.route("**/api/admin/rankings/adjustments/*", async (route) => { await patchGate; await route.continue(); }, { times: 1 });
  await paid.getByRole("button", { name: "确认无需调整" }).click();
  await fillResolution(page, "已核实奖励依据，保留已发奖励");
  await expect(paid.getByRole("button").first()).toBeDisabled();
  finishPatch();
  await expect(panel.getByRole("status").filter({ hasText: "处理结果已保存" })).toBeVisible();
  await expect(paid).toHaveCount(0);
  await expect(period.getByText("测试第2名奖励", { exact: true })).toBeVisible();

  await panel.getByRole("article", { name: "取消测试成员的榜单调整" }).getByRole("button", { name: "取消该奖励" }).click();
  await expect(page.getByRole("dialog")).toContainText("恢复已预留库存一次");
  await fillResolution(page, "已核实原奖励资格不成立，取消未发奖励");
  await expect(panel.getByRole("article", { name: "取消测试成员的榜单调整" })).toHaveCount(0);
  await expect.poll(async () => (await db.gift.findUniqueOrThrow({ where: { id: giftId } })).stock).toBe(5);
  await panel.getByRole("article", { name: "冻结测试成员的榜单调整" }).getByRole("button", { name: "解除本项冻结" }).click();
  await fillResolution(page, "已核实相关性，保留原奖励资格");
  await expect(panel.getByText("暂无待处理的榜单奖励调整")).toBeVisible();
  await panel.getByRole("button", { name: "已处理", exact: true }).click();
  await expect(panel.locator("article")).toHaveCount(3);
  expect((await db.rankingAward.findUniqueOrThrow({ where: { id: awards.paid } })).status).toBe("FULFILLED");
  expect((await db.rankingAward.findUniqueOrThrow({ where: { id: awards.cancel } })).status).toBe("EXPIRED");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `output/playwright/ranking-resolved-${testInfo.project.name}.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("members see frozen awards and cannot bypass holds or admin access checks", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, ids.member);
  await page.getByRole("button", { name: "榜单", exact: true }).click();
  const award = page.locator(".award-section button").filter({ hasText: "已冻结待核实" });
  await expect(award).toBeDisabled();
  await expect(award).toBeVisible();
  await expect(page.getByText("0 份待领取")).toBeVisible();
  const response = await page.request.post(`/api/rankings/awards/${awards.member}`, { data: {}, headers: { origin: new URL(page.url()).origin } });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toContain("冻结");
  const task = await db.rankingAwardAdjustment.findFirstOrThrow({ where: { awardId: awards.member } });
  expect((await page.request.get("/api/admin/rankings/adjustments")).status()).toBe(403);
  expect((await page.request.patch(`/api/admin/rankings/adjustments/${task.id}`, { data: { resolution: "RELEASE", note: "成员不应能解除冻结" }, headers: { origin: new URL(page.url()).origin } })).status()).toBe(403);
  await expectNoHorizontalOverflow(page);
  await expectElementsWithinViewport(page, ".award-section, .award-section button");
  await page.screenshot({ path: `output/playwright/ranking-member-${testInfo.project.name}.png`, fullPage: true });
  await page.context().clearCookies();
  await login(page, ids.reviewer);
  expect((await page.request.get("/api/admin/rankings/adjustments")).status()).toBe(403);
  expect((await page.request.patch(`/api/admin/rankings/adjustments/${task.id}`, { data: { resolution: "RELEASE", note: "审核员不应能处理奖励" }, headers: { origin: new URL(page.url()).origin } })).status()).toBe(403);
  expect((await db.rankingAwardAdjustment.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("PENDING");
  expect(errors).toEqual([]);
});

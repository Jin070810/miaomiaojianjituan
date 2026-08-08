import { expect, test } from "@playwright/test";
import { db } from "@/lib/db";
import {
  cleanupWeeklyChallengeE2E,
  e2eIds,
  expectNoHorizontalOverflow,
  login,
  seedWeeklyChallengeE2E,
} from "./weekly-challenge-fixture";

test.beforeAll(async () => {
  await seedWeeklyChallengeE2E();
});

test.afterAll(async () => {
  await cleanupWeeklyChallengeE2E();
  await db.$disconnect();
});

test("admin sees period health and failure details at 1440x900", async ({ page }) => {
  await login(page, e2eIds.admin);
  await expect(page.getByRole("heading", { name: "运营工作台" })).toBeVisible();
  await expect(page.getByText("待复查申诉", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "AI 周挑战" }).click();
  await expect(page.getByRole("heading", { name: "AI 周挑战" })).toBeVisible();
  await expect(page.getByText("生成失败")).toBeVisible();
  await expect(page.getByText("模拟批次缺失成员，整周未发布")).toBeVisible();
  await expect(page.getByText("e2e-mock-model").first()).toBeVisible();
  await expect(page.getByText("AI + 稳定模板")).toBeVisible();
  await expect(page.getByText("1 个批次使用稳定模板")).toBeVisible();
  await expect(page.getByText("数量 1").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "output/playwright/admin-weekly-periods-1440x900.png", fullPage: true });

  const activeRow = page.getByRole("row").filter({ hasText: "进行中" });
  await activeRow.getByRole("button", { name: "查看" }).click();
  const detailDialog = page.getByRole("dialog", { name: "周期任务详情" });
  await expect(detailDialog).toBeVisible();
  await expect(page.getByText("周挑战测试成员")).toBeVisible();
  await expect(detailDialog.getByText("进行中")).toBeVisible();
  await expect(detailDialog.getByText("模型成本（Token）")).toBeVisible();
  await expect(detailDialog.getByText("稳定模板", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "output/playwright/admin-weekly-detail-1440x900.png", fullPage: true });
});

test("video history opens the fetched photoId instead of the submitted short link", async ({ page }) => {
  await login(page, e2eIds.admin);
  await page.getByRole("button", { name: "视频与申诉" }).click();
  await expect(page.getByRole("heading", { name: "视频与审核" })).toBeVisible();
  await page.getByRole("button", { name: /视频历史/ }).click();
  const videoSearch = page.getByPlaceholder("搜索链接、photoId、作者、驳回原因或快手 ID");
  await videoSearch.fill("e2e-history-photo-987654321");
  await videoSearch.press("Enter");
  await expect(page.locator("a.video-source-link").first()).toHaveAttribute("href", "https://www.kuaishou.com/short-video/e2e-history-photo-987654321");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "output/playwright/admin-video-history-1440x900.png", fullPage: true });
});

test("admin modules load on demand, retry locally, and keep cross-page selections", async ({ page }) => {
  const adminRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/admin/")) adminRequests.push(`${request.method()} ${url.pathname}${url.search}`);
  });
  await login(page, e2eIds.admin);
  await expect(page.getByRole("heading", { name: "运营工作台" })).toBeVisible();
  expect([...new Set(adminRequests.filter((request) => request.startsWith("GET ")))])
    .toEqual(["GET /api/admin/dashboard", "GET /api/admin/workbench?range=7d"]);

  let failVideos = true;
  await page.route("**/api/admin/videos?take=50", async (route) => {
    if (failVideos) {
      failVideos = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "视频模块测试失败" }) });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "视频与申诉" }).click();
  await expect(page.locator(".admin-module-state")).toContainText("视频模块测试失败");
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.getByRole("heading", { name: "视频与审核" })).toBeVisible();
  const videoRequestCount = adminRequests.filter((request) => request.includes("/api/admin/videos?take=50")).length;
  await page.getByRole("button", { name: "运营工作台" }).click();
  await page.getByRole("button", { name: "视频与申诉" }).click();
  await expect(page.getByRole("heading", { name: "视频与审核" })).toBeVisible();
  expect(adminRequests.filter((request) => request.includes("/api/admin/videos?take=50"))).toHaveLength(videoRequestCount);

  const member = (index: number) => ({
    id: `member-${index}`,
    kuaishouId: `ks-${index}`,
    nickname: `成员 ${index}`,
    avatarUrl: null,
    guildStatus: "已入会",
    role: "MEMBER",
    active: true,
    invited: true,
    createdAt: new Date(2026, 6, 25).toISOString(),
    account: { balance: index },
    _count: { videos: 0, redemptions: 0 },
  });
  await page.route("**/api/admin/users?*", async (route) => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get("page") ?? 1);
    const users = pageNumber === 1 ? Array.from({ length: 50 }, (_, index) => member(index + 1)) : [member(51)];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ users, pagination: { page: pageNumber, take: 50, total: 51, pages: 2 } }) });
  });
  await page.route("**/api/admin/points?take=50", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ledger: [], pagination: { page: 1, take: 50, total: 0, pages: 1 } }) }));
  await page.route("**/api/admin/point-rules", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rule: { minimumLikes: 200, fixedTierMaxLikes: 1000, fixedTierPoints: 50, likesDivisor: 2, maximumPoints: 5000, submissionWindowDays: 7 } }) }));
  await page.getByRole("button", { name: "积分管理" }).click();
  await expect(page.getByRole("heading", { name: "积分管理" })).toBeVisible();
  await page.getByText("成员 1 · ks-1").click();
  await expect(page.getByText("成员（已选 1 人）")).toBeVisible();
  await page.getByRole("button", { name: "加载更多成员" }).click();
  await expect(page.getByText("成员 51 · ks-51")).toBeVisible();
  await page.getByText("成员 51 · ks-51").click();
  await expect(page.getByText("成员（已选 2 人）")).toBeVisible();

  let bulkPayload: Record<string, unknown> | null = null;
  await page.route("**/api/admin/points/bulk", async (route) => {
    bulkPayload = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ adjustments: [] }) });
  });
  await page.getByRole("button", { name: "全部有效成员" }).click();
  await page.getByLabel("每人积分变动").fill("5");
  await page.getByLabel("原因").fill("首周运营测试奖励");
  await page.getByRole("button", { name: "预览批量调整" }).click();
  await expect(page.getByText(/最终人数由服务端事务确认/)).toBeVisible();
  await page.getByRole("button", { name: "确认调整" }).click();
  await expect(page.getByText("积分调整已记录，余额和审计日志已更新。")).toBeVisible();
  expect(bulkPayload).toMatchObject({ selectionMode: "ALL_ACTIVE_MEMBERS", amount: 5, reason: "首周运营测试奖励" });

  let orderPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/api/admin/orders/")) orderPosts += 1;
  });
  await page.route("**/api/admin/orders?take=20", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      orders: [{ id: "order-missing", totalCost: 100, status: "PENDING", createdAt: new Date().toISOString(), hasRecipientName: false, hasRecipientPhone: false, hasRecipientAddress: false, gift: { name: "测试礼品", kind: "PHYSICAL", imageUrl: null }, user: { nickname: "资料缺失成员", kuaishouId: "missing-profile" } }],
      pagination: { page: 1, take: 20, total: 1, pages: 1 },
      statusCounts: { all: 1, pending: 1, fulfilled: 0 },
    }),
  }));
  await page.getByRole("button", { name: "兑换订单" }).click();
  await page.getByRole("button", { name: "发货", exact: true }).click();
  await expect(page.locator(".form-error")).toContainText("尚未填写完整收货资料");
  expect(orderPosts).toBe(0);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "output/playwright/admin-lazy-modules-1440x900.png", fullPage: true });
});

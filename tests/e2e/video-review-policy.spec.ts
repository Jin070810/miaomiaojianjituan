import path from "node:path";
import { expect, test } from "@playwright/test";
import { db } from "@/lib/db";
import { cleanupWeeklyChallengeE2E, e2eIds, expectElementsWithinViewport, expectNoHorizontalOverflow, login, seedWeeklyChallengeE2E } from "./weekly-challenge-fixture";

let legacyReviewId: string;
let appealVideoId: string;
test.beforeAll(async () => {
  await seedWeeklyChallengeE2E();
  const member = await db.user.findUniqueOrThrow({ where: { kuaishouId: e2eIds.member } });
  const admin = await db.user.findUniqueOrThrow({ where: { kuaishouId: e2eIds.admin } });
  const legacy = await db.videoSubmission.create({ data: {
    userId: member.id, sourceUrl: "https://v.kuaishou.com/legacyE2E", requestUrl: "https://v.kuaishou.com/legacyE2E",
    sourceKind: "short-link", submittedNickname: member.nickname, status: "APPROVED", points: 80, likes: 600,
    caption: "历史二审只读验收视频", idempotencyKey: "e2e-retired-review",
  } });
  legacyReviewId = (await db.videoSecondaryReview.create({ data: { videoId: legacy.id, reviewerId: admin.id } })).id;
  const appealVideo = await db.videoSubmission.create({ data: {
    userId: member.id, sourceUrl: "https://v.kuaishou.com/appealE2E", requestUrl: "https://v.kuaishou.com/appealE2E",
    sourceKind: "short-link", submittedNickname: member.nickname, status: "REJECTED", likes: 600,
    photoId: `e2e-appeal-${Date.now()}`, reviewReason: "作者名称需要确认", idempotencyKey: "e2e-appeal-policy",
  } });
  appealVideoId = appealVideo.id;
  await db.videoAppeal.create({ data: { videoId: appealVideo.id, userId: member.id, reason: "作者昵称带有装饰字符", idempotencyKey: "e2e-policy-appeal" } });
});
test.afterAll(async () => { await cleanupWeeklyChallengeE2E(); await db.$disconnect(); });

test("admin handles appeals without loading or processing secondary reviews", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  let archiveRequests = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("request", (request) => { if (request.url().includes("/api/reviewer/video-reviews")) archiveRequests++; });
  await login(page, e2eIds.admin);
  if (testInfo.project.name.includes("mobile")) {
    await page.getByRole("button", { name: "打开菜单" }).click();
    await page.getByRole("navigation", { name: "管理后台导航" }).getByRole("button", { name: /视频与申诉/ }).click();
  } else {
    await page.locator(".admin-sidebar").getByRole("button", { name: /视频与申诉/ }).click();
  }
  await expect(page.getByRole("heading", { name: "待复查申诉" })).toBeVisible();
  await expect(page.getByText("普通视频由系统自动审核，人工仅处理成员申诉。")).toBeVisible();
  await expect(page.getByRole("button", { name: "二审通过" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "二审驳回" })).toHaveCount(0);
  expect(archiveRequests).toBe(0);
  if (testInfo.project.name.includes("mobile")) {
    await expect(page.locator(".appeal-review-card")).toBeVisible();
    await expect(page.locator(".appeal-review-table")).toBeHidden();
    await expect(page.getByRole("button", { name: "通过申诉", exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "驳回申诉", exact: true })).toBeInViewport();
    await expectElementsWithinViewport(page, ".appeal-review-card-actions button");
    const heights = await page.locator(".appeal-review-card-actions button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
    expect(heights.every((height) => height >= 44)).toBe(true);
  }
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "output/playwright", `review-policy-${testInfo.project.name}.png`), fullPage: true });

  await page.getByRole("button", { name: "通过申诉", exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("spinbutton").fill("80");
  await page.getByRole("button", { name: "确认通过", exact: true }).click();
  await page.getByRole("button", { name: "确认通过并入账", exact: true }).click();
  await expect(page.getByText("暂无待复查申诉")).toBeVisible();
  expect(await db.pointLedger.count({ where: { referenceId: appealVideoId, type: "VIDEO_REWARD" } })).toBe(1);
  expect(await db.videoSecondaryReview.count({ where: { videoId: appealVideoId } })).toBe(0);
  const metrics = (await (await page.request.get("/api/admin/dashboard")).json()).metrics;
  expect(metrics.pendingVideos).toBe(metrics.pendingAppeals);
  expect(metrics.pendingSecondaryReviews).toBe(0);
  const retired = await page.request.post(`/api/reviewer/video-reviews/${legacyReviewId}`, { data: { action: "reject", reason: "旧客户端请求" } });
  expect(retired.status()).toBe(410);
  expect((await db.videoSecondaryReview.findUniqueOrThrow({ where: { id: legacyReviewId } })).status).toBe("PENDING");
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("history is read-only with loading, empty, failure and refresh states", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page, e2eIds.admin);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/reviewer/video-reviews?**", async (route) => { await pending; await route.continue(); });
  await page.goto("/reviewer");
  await expect(page).toHaveURL(/\/reviewer$/);
  await expect(page).toHaveTitle(/妙妙/);
  await expect(page.getByRole("heading", { name: "历史二审记录" })).toBeVisible();
  await expect(page.getByText("正在加载历史记录...")).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新历史记录" })).toBeDisabled();
  release();
  await expect(page.getByText("历史二审只读验收视频")).toBeVisible();
  await expect(page.getByRole("button", { name: /^(通过|驳回)$/ })).toHaveCount(0);
  await expect(page.getByRole("article").filter({ hasText: "历史二审只读验收视频" }).getByRole("link", { name: "打开视频" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "output/playwright", `review-history-${testInfo.project.name}.png`), fullPage: true });
  await page.getByRole("button", { name: "已通过", exact: true }).click();
  await expect(page.getByText("暂无已通过记录")).toBeVisible();
  await page.unroute("**/api/reviewer/video-reviews?**");
  let fail = true;
  await page.route("**/api/reviewer/video-reviews?**", async (route) => {
    if (fail) { fail = false; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "历史记录暂不可用" }) }); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "历史未处理", exact: true }).click();
  await expect(page.locator(".reviewer-page").getByRole("alert")).toContainText("历史记录暂不可用");
  await page.getByRole("button", { name: "刷新历史记录" }).click();
  await expect(page.locator(".reviewer-page").getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("历史二审只读验收视频")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

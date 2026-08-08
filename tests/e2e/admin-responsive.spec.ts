import { expect, test } from "@playwright/test";
import { db } from "@/lib/db";
import { cleanupWeeklyChallengeE2E, e2eIds, expectNoHorizontalOverflow, login, seedWeeklyChallengeE2E } from "./weekly-challenge-fixture";

test.beforeAll(async () => {
  await seedWeeklyChallengeE2E();
});

test.afterAll(async () => {
  await cleanupWeeklyChallengeE2E();
  await db.$disconnect();
});

test("admin navigation resets scroll and responsive pages do not overflow", async ({ page }, testInfo) => {
  await login(page, e2eIds.admin);
  await expect(page.getByRole("heading", { name: "运营工作台" })).toBeVisible();
  await expect(page.locator(".workbench-queue-grid")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  if (testInfo.project.name.includes("mobile")) {
    await page.getByRole("button", { name: "打开菜单" }).click();
    const navigation = page.getByRole("navigation", { name: "管理后台导航" });
    await expect(navigation.getByRole("button", { name: "密码协助中心" })).toBeVisible();
    await expect(navigation.getByRole("button", { name: "退出后台" })).toBeVisible();
    await navigation.getByRole("button", { name: /兑换订单/ }).click();
  } else {
    await page.locator(".admin-sidebar").getByRole("button", { name: /兑换订单/ }).click();
  }

  await expect(page.getByRole("heading", { name: "兑换订单" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator("input[placeholder='搜索订单号或快手 ID']")).toBeVisible();
  await expect(page.locator(".order-status-row b")).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `output/playwright/admin-responsive-${testInfo.project.name}.png`, fullPage: true });
});

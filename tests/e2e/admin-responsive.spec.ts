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

test("gift action menu renders above neighboring cards", async ({ page }, testInfo) => {
  await login(page, e2eIds.admin);

  if (testInfo.project.name.includes("mobile")) {
    await page.getByRole("button", { name: "打开菜单" }).click();
    await page.getByRole("navigation", { name: "管理后台导航" }).getByRole("button", { name: "礼品管理" }).click();
  } else {
    await page.locator(".admin-sidebar").getByRole("button", { name: "礼品管理" }).click();
  }

  await expect(page.getByRole("heading", { name: "礼品目录" })).toBeVisible();
  const firstCard = page.locator(".gift-admin-card").first();
  await firstCard.getByRole("button", { name: /操作菜单/ }).click();

  const menu = firstCard.locator(".gift-action-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button")).toHaveCount(5);
  const deleteButton = menu.getByRole("button", { name: "删除" });
  await deleteButton.scrollIntoViewIfNeeded();
  await expect(deleteButton).toBeVisible();
  const geometry = await firstCard.evaluate((card) => {
    const menuElement = card.querySelector<HTMLElement>(".gift-action-menu");
    const lastButton = menuElement?.querySelector<HTMLElement>("button:last-child");
    if (!menuElement || !lastButton) return null;
    const cardRect = card.getBoundingClientRect();
    const menuRect = menuElement.getBoundingClientRect();
    const buttonRect = lastButton.getBoundingClientRect();
    const hit = document.elementFromPoint(buttonRect.left + buttonRect.width / 2, buttonRect.top + buttonRect.height / 2);
    return {
      cardBottom: cardRect.bottom,
      menuBottom: menuRect.bottom,
      menuHeight: menuRect.height,
      lastButtonReceivesPointer: hit === lastButton || lastButton.contains(hit),
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.menuHeight).toBeGreaterThanOrEqual(220);
  expect(geometry!.menuBottom).toBeGreaterThan(geometry!.cardBottom);
  expect(geometry!.lastButtonReceivesPointer).toBe(true);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `output/playwright/admin-gift-menu-${testInfo.project.name}.png`, fullPage: false });
});

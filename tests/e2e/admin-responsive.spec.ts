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

test("admin primary actions keep readable contrast and invite entry opens registration settings", async ({ page }, testInfo) => {
  await login(page, e2eIds.admin);

  if (testInfo.project.name.includes("mobile")) {
    await page.getByRole("button", { name: "打开菜单" }).click();
    await page.getByRole("navigation", { name: "管理后台导航" }).getByRole("button", { name: "用户与公会" }).click();
  } else {
    await page.locator(".admin-sidebar").getByRole("button", { name: "用户与公会" }).click();
  }

  const inviteButton = page.getByRole("button", { name: "邀请成员" });
  await expect(inviteButton).toBeVisible();
  const inviteStyle = await inviteButton.evaluate((button) => {
    const style = getComputedStyle(button);
    return { backgroundColor: style.backgroundColor, color: style.color };
  });
  expect(inviteStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(inviteStyle.backgroundColor).not.toBe(inviteStyle.color);

  await inviteButton.click();
  await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "入团申请链接" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("password support heading keeps usable width without an avatar column", async ({ page }) => {
  await login(page, e2eIds.admin);
  await page.goto("/password-support");
  await expect(page.getByRole("heading", { name: "密码协助中心" })).toBeVisible();
  const headingWidth = await page.locator(".support-profile-head .profile-copy").evaluate((element) => element.getBoundingClientRect().width);
  expect(headingWidth).toBeGreaterThan(180);
  await expectNoHorizontalOverflow(page);
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

test("voluntary exits are separated from automatic clearance history", async ({ page }, testInfo) => {
  await page.route("**/api/admin/member-exits?*", (route) => {
    const search = new URL(route.request().url()).searchParams.get("search");
    if (search === "接口失败") {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "主动退团记录加载失败" }) });
    }
    const exits = search === "无结果" ? [] : [{
      id: "voluntary-exit-audit-1",
      userId: "voluntary-exit-user-1",
      reason: "因学业等原因没有时间继续剪辑",
      exitedAt: "2026-08-16T13:21:00.000Z",
      forfeitedPoints: 180,
      clearedOrders: 1,
      restoredStockOrders: 1,
      member: { id: "voluntary-exit-user-1", nickname: "E2E主动退团成员", kuaishouId: "e2e-voluntary-exit", active: false },
    }];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ exits, pagination: { page: 1, take: 50, total: exits.length, pages: exits.length ? 1 : 0 } }),
    });
  });
  await page.route("**/api/admin/operation-switches", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ switches: [] }),
  }));
  await page.route("**/api/admin/member-clearance", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      policy: { version: 1, inactivityDays: 30, warningDays: [7, 3], cooldownDays: 15 },
      program: { firstEnabledAt: "2026-07-31T02:38:54.174Z" },
      eligibilities: [],
      requests: [],
      summary: { activeMemberCount: 381, clearedHistoryCount: 0, currentClearanceCount: 0 },
      clearedMembers: [],
      operations: { dueWithin7Days: 295, dueBalanceTotal: 39786, dueOpenOrders: 0, overdueActive: 0, missedWarnings: 0 },
    }),
  }));

  await login(page, e2eIds.admin);
  if (testInfo.project.name.includes("mobile")) {
    await page.getByRole("button", { name: "打开菜单" }).click();
    await page.getByRole("navigation", { name: "管理后台导航" }).getByRole("button", { name: "用户与公会" }).click();
  } else {
    await page.locator(".admin-sidebar").getByRole("button", { name: "用户与公会" }).click();
  }
  await expect(page.getByRole("heading", { name: "用户与公会" })).toBeVisible();
  await page.getByRole("button", { name: /主动退团/ }).click();
  await expect(page.getByRole("heading", { name: "主动退团记录" })).toBeVisible();
  await expect(page.getByText("E2E主动退团成员")).toBeVisible();
  await expect(page.getByText("因学业等原因没有时间继续剪辑")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `output/playwright/admin-voluntary-exits-${testInfo.project.name}.png`, fullPage: true });

  const exitSearch = page.getByPlaceholder("搜索快手 ID 或昵称");
  await exitSearch.fill("无结果");
  await page.getByRole("button", { name: "搜索主动退团记录" }).click();
  await expect(page.getByText("暂无主动退团记录")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await exitSearch.fill("接口失败");
  await page.getByRole("button", { name: "搜索主动退团记录" }).click();
  await expect(page.getByText("主动退团记录加载失败")).toBeVisible();

  if (testInfo.project.name.includes("mobile")) {
    await page.getByRole("button", { name: "打开菜单" }).click();
    await page.getByRole("navigation", { name: "管理后台导航" }).getByRole("button", { name: "系统设置" }).click();
  } else {
    await page.locator(".admin-sidebar").getByRole("button", { name: "系统设置" }).click();
  }
  await expect(page.getByRole("heading", { name: "自动清退与冷却名单" })).toBeVisible();
  await expect(page.getByText("暂无自动清退成员。")).toBeVisible();
  await expect(page.getByText("E2E主动退团成员")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

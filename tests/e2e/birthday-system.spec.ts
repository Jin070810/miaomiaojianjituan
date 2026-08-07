import { expect, test } from "@playwright/test";
import { db } from "@/lib/db";
import { birthdayE2EIds, birthdayE2EPassword, cleanupBirthdayE2E, seedBirthdayE2E } from "./birthday-fixture";
import { expectElementsWithinViewport, expectNoHorizontalOverflow } from "./weekly-challenge-fixture";

test.setTimeout(60_000);

test.beforeAll(async () => { await seedBirthdayE2E(); });
test.afterAll(async () => { await cleanupBirthdayE2E(); await db.$disconnect(); });

async function login(page: import("@playwright/test").Page, kuaishouId: string) {
  const response = await page.request.post("/api/auth/login", { data: { kuaishouId, password: birthdayE2EPassword }, headers: { "x-real-ip": "198.51.100.87" } });
  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  await page.goto(result.user.role === "ADMIN" ? "/admin" : "/");
}

test("birthday wall reveals birthdays only after member entry", async ({ page }) => {
  await login(page, birthdayE2EIds.member);
  await expect(page.getByRole("heading", { name: "生日星愿" })).toBeVisible();
  await expect(page.getByText("今日公开寿星")).toHaveCount(0);
  const member = await db.user.findUniqueOrThrow({ where: { kuaishouId: birthdayE2EIds.member } });
  const notificationsBefore = await db.notification.count({ where: { userId: member.id } });

  await page.getByRole("button", { name: "进入生日星愿" }).click();
  await expect(page.getByRole("heading", { name: "今日寿星" })).toBeVisible();
  await expect(page.getByText("今日公开寿星")).toBeVisible();
  await expect(page.getByText("今日隐藏寿星")).toHaveCount(0);
  await expect(page.getByText("birthday-draw-v1")).not.toBeVisible();
  await page.getByText("查看公开概率").click();
  await expect(page.getByText("birthday-draw-v1")).toBeVisible();
  await expect(page.getByText("1000–2000 分商品")).toBeVisible();
  expect(await db.notification.count({ where: { userId: member.id } })).toBe(notificationsBefore);
  await expectNoHorizontalOverflow(page);
  await expectElementsWithinViewport(page, ".member-app, .member-content, .birthday-page, .birthday-person, .birthday-draw-panel");
});

test("birthday admin operations render with server-side admin access", async ({ page }) => {
  await login(page, birthdayE2EIds.admin);
  await expect(page.getByRole("heading", { name: "运营工作台" })).toBeVisible();
  const menuButton = page.locator(".mobile-admin-menu");
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    await page.locator(".admin-mobile-nav").getByRole("button", { name: "生日运营", exact: true }).click();
  } else {
    await page.locator(".admin-sidebar").getByRole("button").filter({ hasText: "生日运营" }).click();
  }
  await expect(page.getByRole("heading", { name: "生日运营" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "商城商品奖池" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "近期寿星" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "生日纠错" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "待处理窗口" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectElementsWithinViewport(page, ".admin-shell, .admin-main, .admin-page, .birthday-correction-form, .birthday-window-controls");
});

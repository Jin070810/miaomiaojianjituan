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

test("admin workbench navigation stays usable at 390x844", async ({ page }) => {
  await login(page, e2eIds.admin);
  await expect(page.getByRole("heading", { name: "运营工作台" })).toBeVisible();
  await page.getByRole("button", { name: "打开菜单" }).click();
  const navigation = page.getByRole("navigation", { name: "管理后台导航" });
  await expect(navigation).toBeVisible();
  await navigation.getByRole("button", { name: "视频与申诉" }).click();
  await expect(page.getByRole("heading", { name: "视频与审核" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "output/playwright/admin-workbench-390x844.png", fullPage: true });
});

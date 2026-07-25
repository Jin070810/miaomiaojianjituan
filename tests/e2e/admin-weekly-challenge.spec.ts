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
  await page.getByRole("button", { name: "AI 周挑战" }).click();
  await expect(page.getByRole("heading", { name: "AI 周挑战" })).toBeVisible();
  await expect(page.getByText("生成失败")).toBeVisible();
  await expect(page.getByText("模拟批次缺失成员，整周未发布")).toBeVisible();
  await expect(page.getByText("e2e-mock-model").first()).toBeVisible();
  await expect(page.getByText("数量 1")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "output/playwright/admin-weekly-periods-1440x900.png", fullPage: true });

  const activeRow = page.getByRole("row").filter({ hasText: "进行中" });
  await activeRow.getByRole("button", { name: "查看" }).click();
  const detailDialog = page.getByRole("dialog", { name: "周期任务详情" });
  await expect(detailDialog).toBeVisible();
  await expect(page.getByText("周挑战测试成员")).toBeVisible();
  await expect(detailDialog.getByText("进行中")).toBeVisible();
  await expect(detailDialog.getByText("模型成本（Token）")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "output/playwright/admin-weekly-detail-1440x900.png", fullPage: true });
});

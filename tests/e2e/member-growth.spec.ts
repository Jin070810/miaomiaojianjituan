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

test("member growth loads locally, retries, and fits the configured viewport", async ({ page }, testInfo) => {
  const currentStart = new Date("2026-07-26T16:00:00.000Z");
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const trend = Array.from({ length: 8 }, (_, index) => ({
    start: new Date(currentStart.getTime() - (7 - index) * weekMs).toISOString(),
    end: new Date(currentStart.getTime() - (6 - index) * weekMs).toISOString(),
    approvedVideos: index === 7 ? 1234567 : index,
    likes: index === 7 ? 9999999999 : index * 1200,
    videoPoints: index === 7 ? 888888888 : index * 300,
    averageLikes: index === 7 ? 8100 : index * 100,
    complete: index < 7,
  }));
  const payload = {
    timezone: "Asia/Shanghai",
    generatedAt: "2026-07-28T10:00:00.000Z",
    currentWeek: trend[7],
    previousWeekSameWindow: {
      start: "2026-07-19T16:00:00.000Z",
      end: "2026-07-21T10:00:00.000Z",
      approvedVideos: 0,
      likes: 0,
      videoPoints: 0,
      averageLikes: 0,
    },
    delta: { approvedVideos: 1234567, likes: 9999999999, videoPoints: 888888888 },
    trend,
    topVideos: [
      { id: "top-1", sourceUrl: "https://v.kuaishou.com/member-growth-top-video-with-a-very-long-reference", submittedAt: "2026-07-27T02:00:00.000Z", likes: 9999999999, points: 5000 },
      { id: "top-2", sourceUrl: "https://v.kuaishou.com/member-growth-second", submittedAt: "2026-07-26T03:00:00.000Z", likes: 8000, points: 4000 },
    ],
  };
  let attempts = 0;
  await page.route("**/api/member/growth", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "模拟成长接口失败" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });

  await login(page, e2eIds.noTaskMember);
  await expect(page.getByRole("heading", { name: "本周成长" })).toBeVisible();
  await expect(page.getByText("模拟成长接口失败")).toBeVisible();
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.getByText("9,999,999,999").first()).toBeVisible();
  await expect(page.getByText("本周开始有记录").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `output/playwright/member-growth-home-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "查看 8 周趋势" }).click();
  await expect(page.getByRole("heading", { name: "成长记录" })).toBeVisible();
  await expect(page.locator(".growth-trend-list article")).toHaveCount(8);
  await expect(page.getByRole("heading", { name: "本月高光切片" })).toBeVisible();
  await expect(page.getByText("member-growth-top-video-with-a-very-long-reference")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `output/playwright/member-growth-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

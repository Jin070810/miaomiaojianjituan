import { expect, test } from "@playwright/test";
import { db } from "@/lib/db";
import {
  cleanupWeeklyChallengeE2E,
  e2eIds,
  expectNoHorizontalOverflow,
  login,
  seedWeeklyChallengeE2E,
} from "./weekly-challenge-fixture";

let seeded: Awaited<ReturnType<typeof seedWeeklyChallengeE2E>>;

test.beforeAll(async () => {
  seeded = await seedWeeklyChallengeE2E();
});

test.afterAll(async () => {
  await cleanupWeeklyChallengeE2E();
  await db.$disconnect();
});

test("member weekly challenge states fit 390x844", async ({ page }) => {
  await login(page, e2eIds.noTaskMember);
  await expect(page.getByRole("heading", { name: "完成 2 条稳定输出" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  let releaseDashboard: (() => void) | undefined;
  const dashboardGate = new Promise<void>((resolve) => {
    releaseDashboard = resolve;
  });
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    await dashboardGate;
    await route.fulfill({ response });
  });
  const reload = page.reload();
  await expect(page.getByLabel("正在加载")).toBeVisible();
  releaseDashboard?.();
  await reload;
  await expect(page.getByLabel("正在加载")).toHaveCount(0);
  await page.unroute("**/api/dashboard");

  await page.request.post("/api/auth/logout");
  await login(page, e2eIds.member);
  await expect(page.getByRole("heading", { name: "完成 2 条稳定输出" })).toBeVisible();
  await expect(page.getByText("1 / 2")).toBeVisible();
  await expect(page.getByText("进行中")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "output/playwright/member-weekly-progress-390x844.png", fullPage: true });

  await db.videoSubmission.create({
    data: {
      userId: seeded.member.id,
      sourceUrl: "https://v.kuaishou.com/weekly-e2e-complete",
      requestUrl: "https://v.kuaishou.com/weekly-e2e-complete",
      sourceKind: "short-link",
      status: "APPROVED",
      likes: 700,
      submittedNickname: seeded.member.nickname,
      submittedAt: new Date(seeded.period.periodStart.getTime() + 120_000),
      idempotencyKey: "weekly-e2e-complete-video",
    },
  });
  await db.systemSetting.update({ where: { key: "WEEKLY_CHALLENGES" }, data: { enabled: false } });
  await page.reload();
  await expect(page.getByText("已达标")).toBeVisible();
  await expect(page.getByRole("button", { name: "发放暂停" })).toBeDisabled();

  await db.systemSetting.update({ where: { key: "WEEKLY_CHALLENGES" }, data: { enabled: true } });
  await page.reload();
  let releaseClaim: (() => void) | undefined;
  const claimGate = new Promise<void>((resolve) => {
    releaseClaim = resolve;
  });
  await page.route("**/api/weekly-challenges/*/claim", async (route) => {
    const response = await route.fetch();
    await claimGate;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "领取奖励" }).click();
  await expect(page.getByRole("button", { name: "领取中..." })).toBeDisabled();
  releaseClaim?.();
  await expect(page.getByText("已领取")).toBeVisible();
  await page.unroute("**/api/weekly-challenges/*/claim");

  await db.weeklyRaceWinner.create({
    data: {
      periodId: seeded.period.id,
      assignmentId: seeded.assignment.id,
      userId: seeded.member.id,
      rewardPoints: 2000,
      wonAt: new Date(),
    },
  });
  await page.reload();
  await expect(page.getByText("本周竞速已结束")).toBeVisible();
  const unreadPromptClose = page.getByRole("button", { name: "关闭未读通知提醒" });
  await unreadPromptClose.waitFor({ state: "visible", timeout: 3000 }).catch(() => undefined);
  if (await unreadPromptClose.isVisible()) await unreadPromptClose.click();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "output/playwright/member-weekly-claimed-390x844.png", fullPage: true });
});

test("member video clipboard and submission feedback fit 390x844", async ({ page }) => {
  await login(page, e2eIds.noTaskMember);
  const openDialog = async () => {
    await page.getByRole("button", { name: "提交视频" }).click();
    await expect(page.getByRole("heading", { name: "提交快手视频" })).toBeVisible();
  };
  const setClipboard = async (mode: "success" | "empty" | "denied" | "unsupported" | "long") => {
    await page.evaluate((clipboardMode) => {
      const readText = clipboardMode === "denied"
        ? () => Promise.reject(new DOMException("denied", "NotAllowedError"))
        : () => Promise.resolve(clipboardMode === "empty" ? "" : clipboardMode === "long" ? "文".repeat(2001) : "作品分享 https://v.kuaishou.com/e2e-clipboard 更多内容");
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: clipboardMode === "unsupported" ? {} : { readText },
      });
    }, mode);
  };

  await openDialog();
  await setClipboard("success");
  await page.getByRole("button", { name: "粘贴" }).click();
  await expect(page.getByLabel("快手视频链接")).toHaveValue(/v\.kuaishou\.com\/e2e-clipboard/);
  await expect(page.getByText(/\/ 2,000 字/)).toBeVisible();

  let releaseSubmit: (() => void) | undefined;
  const submitGate = new Promise<void>((resolve) => { releaseSubmit = resolve; });
  await page.route("**/api/videos", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await submitGate;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ video: { id: "e2e-video" } }) });
  });
  await page.getByRole("button", { name: "提交并开始校验" }).click();
  await expect(page.getByRole("button", { name: "正在提交..." })).toBeDisabled();
  releaseSubmit?.();
  await expect(page.getByRole("heading", { name: "已进入校验队列" })).toBeVisible();
  await page.unroute("**/api/videos");
  await page.getByRole("button", { name: "关闭" }).click();

  await openDialog();
  await setClipboard("empty");
  await page.getByRole("button", { name: "粘贴" }).click();
  await expect(page.locator(".form-error")).toContainText("剪贴板中没有可粘贴的内容");
  await setClipboard("denied");
  await page.getByRole("button", { name: "粘贴" }).click();
  await expect(page.locator(".form-error")).toContainText("无法读取剪贴板");
  await setClipboard("unsupported");
  await page.getByRole("button", { name: "粘贴" }).click();
  await expect(page.locator(".form-error")).toContainText("当前浏览器无法直接读取剪贴板");
  await setClipboard("long");
  await page.getByRole("button", { name: "粘贴" }).click();
  await expect(page.locator(".form-error")).toContainText("超过 2,000 字");
  await expect(page.getByRole("button", { name: "提交并开始校验" })).toBeDisabled();

  await page.getByLabel("快手视频链接").fill("https://v.kuaishou.com/e2e-failure");
  await page.route("**/api/videos", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "处理队列暂时不可用" }) });
  });
  await page.getByRole("button", { name: "提交并开始校验" }).click();
  await expect(page.locator(".form-error")).toContainText("处理队列暂时不可用");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "output/playwright/member-video-feedback-390x844.png", fullPage: true });
});

import { expect, test } from "@playwright/test";
import { db } from "@/lib/db";
import {
  cleanupWeeklyChallengeE2E,
  e2ePassword,
  e2eIds,
  expectElementsWithinViewport,
  expectNoHorizontalOverflow,
  seedWeeklyChallengeE2E,
} from "./weekly-challenge-fixture";

test.setTimeout(60_000);

test.beforeAll(async () => {
  await seedWeeklyChallengeE2E();
});

test.afterAll(async () => {
  await cleanupWeeklyChallengeE2E();
  await db.$disconnect();
});

async function expectMemberViewport(page: import("@playwright/test").Page) {
  await expectNoHorizontalOverflow(page);
  await expectElementsWithinViewport(page, ".member-app, .member-topbar, .member-content, .bottom-nav");
}

async function loginForViewportCheck(page: import("@playwright/test").Page, kuaishouId: string) {
  const testIp = `198.51.${100 + Math.floor(Math.random() * 50)}.${1 + Math.floor(Math.random() * 253)}`;
  const response = await page.request.post("/api/auth/login", {
    data: { kuaishouId, password: e2ePassword },
    headers: { "x-real-ip": testIp },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/");
}

async function expectDialogViewport(page: import("@playwright/test").Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectElementsWithinViewport(page, ".modal-sheet, .modal-head, .modal-submit, .notification-panel");
  return dialog;
}

test("member primary views and sheets fit the configured mobile viewport", async ({ page }, testInfo) => {
  await loginForViewportCheck(page, e2eIds.noTaskMember);
  await expectMemberViewport(page);

  await page.getByRole("button", { name: /^通知/ }).click();
  await expect(page.getByRole("heading", { name: "通知中心" })).toBeVisible();
  await expectDialogViewport(page);
  await page.getByRole("button", { name: "关闭通知中心" }).click();

  const navigation = page.getByRole("navigation", { name: "成员导航" });
  const views = [
    ["切片", "我的切片"],
    ["礼物", "积分礼物屋"],
    ["榜单", "剪辑团榜单"],
    ["我的", "暂无任务成员"],
  ] as const;
  for (const [label, heading] of views) {
    await navigation.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expectMemberViewport(page);
  }

  await page.getByRole("button", { name: "成长记录" }).click();
  await expect(page.getByRole("heading", { name: "成长记录" })).toBeVisible();
  await expectMemberViewport(page);
  await page.getByRole("button", { name: "返回" }).click();

  await navigation.getByRole("button", { name: "我的", exact: true }).click();
  await page.getByRole("button", { name: "积分记录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "积分记录" })).toBeVisible();
  await expectMemberViewport(page);
  await page.getByRole("button", { name: "返回" }).click();

  await navigation.getByRole("button", { name: "切片", exact: true }).click();
  await page.getByRole("button", { name: "提交切片", exact: true }).click();
  const submitDialog = await expectDialogViewport(page);
  await submitDialog.getByLabel("快手链接或分享内容").focus();
  await expect(submitDialog.getByRole("button", { name: "提交切片", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();

  await navigation.getByRole("button", { name: "我的", exact: true }).click();
  await page.getByRole("button", { name: "送积分给团友" }).click();
  const transferDialog = await expectDialogViewport(page);
  await transferDialog.getByLabel("团友的快手 ID").focus();
  await expect(transferDialog.getByRole("button", { name: "找到这位团友" })).toBeDisabled();
  await page.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: "收货与收款信息" }).click();
  await expectDialogViewport(page);
  await page.getByLabel("详细地址").focus();
  await page.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: "修改资料" }).click();
  const profileDialog = await expectDialogViewport(page);
  await expect(profileDialog.getByRole("heading", { name: "修改我的信息" })).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();

  await navigation.getByRole("button", { name: "礼物", exact: true }).click();
  await page.getByRole("button", { name: "查看" }).first().click();
  const redeemDialog = await expectDialogViewport(page);
  await expect(redeemDialog.getByRole("heading", { name: "确认兑换" })).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();

  await page.screenshot({
    path: `output/playwright/member-mobile-matrix-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("login, register, and password reset remain within the configured mobile viewport", async ({ page }) => {
  await page.goto("/login");
  const expectAuthViewport = async () => {
    await expectNoHorizontalOverflow(page);
    await expectElementsWithinViewport(page, ".auth-journal, .auth-hero, .auth-panel, .auth-form");
  };

  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await expectAuthViewport();
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page.getByRole("heading", { name: "加入剪辑团" })).toBeVisible();
  await expectAuthViewport();
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("button", { name: "忘记密码？提交找回申请" }).click();
  await expect(page.getByRole("heading", { name: "找回账号" })).toBeVisible();
  await expectAuthViewport();
  await page.getByLabel("新密码", { exact: true }).focus();
  await expect(page.getByRole("button", { name: "提交找回申请" })).toBeVisible();
});

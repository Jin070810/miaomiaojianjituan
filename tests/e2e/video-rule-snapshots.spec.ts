import { seedVerifiedVideoAuthor } from "../helpers/verified-author";
import path from "node:path";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { db } from "@/lib/db";
import { DEFAULT_VIDEO_POINT_RULE } from "@/lib/point-rules";
import { videoRuleRevision } from "@/lib/video-point-rule-snapshots";
import { e2ePassword, expectNoHorizontalOverflow, login } from "./weekly-challenge-fixture";

let memberId: string;
let adminId: string;
const adminLogin = "rule-snapshot-e2e-admin";
const userLogins = [adminLogin, "rule-snapshot-e2e-member"];

async function cleanup() {
  const users = await db.user.findMany({ where: { kuaishouId: { in: userLogins } }, select: { id: true } });
  const ids = users.map((user) => user.id);
  const videos = await db.videoSubmission.findMany({ where: { userId: { in: ids } }, select: { id: true, appeals: { select: { id: true } } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: videos.flatMap((v) => [v.id, ...v.appeals.map((a) => a.id)]) } }] } });
  await db.pointLedger.deleteMany({ where: { account: { userId: { in: ids } } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

test.beforeEach(async () => {
  if (!process.env.DATABASE_URL?.includes("schema=")) throw new Error("E2E requires an explicit test schema");
  await cleanup();
  const passwordHash = await argon2.hash(e2ePassword);
  const [admin, member] = await Promise.all([
    db.user.create({ data: { kuaishouId: adminLogin, nickname: "规则验收管理员", passwordHash, role: "ADMIN", account: { create: {} } } }),
    db.user.create({ data: { kuaishouId: userLogins[1], nickname: "规则验收成员", passwordHash, account: { create: {} } } }),
  ]);
  adminId = admin.id; memberId = member.id;
});
test.afterEach(cleanup);
test.afterAll(async () => db.$disconnect());

async function seedAppeal(locked: boolean) {
  const video = await db.videoSubmission.create({ data: {
    userId: memberId, sourceUrl: "https://v.kuaishou.com/ruleE2E", requestUrl: "https://v.kuaishou.com/ruleE2E",
    sourceKind: "short-link", status: "REJECTED", likes: 600, submittedNickname: "规则验收成员",
    reviewReason: "作者名称需核实", idempotencyKey: randomUUID(),
    ...(locked ? { pointRuleSnapshot: { create: { ...DEFAULT_VIDEO_POINT_RULE, revision: videoRuleRevision(DEFAULT_VIDEO_POINT_RULE), formulaVersion: "likes-v1", origin: "FIRST_AUTOMATIC_REVIEW" } } } : {}),
  } });
  await seedVerifiedVideoAuthor(video.id);
  const appeal = await db.videoAppeal.create({ data: { videoId: video.id, userId: memberId, reason: "请核对作者信息", idempotencyKey: randomUUID() } });
  return { video, appeal };
}

async function openAppeals(page: Page, info: TestInfo) {
  await login(page, adminLogin);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page).toHaveTitle(/妙妙/);
  if (info.project.name.includes("mobile")) {
    await page.getByRole("button", { name: "打开菜单" }).click();
    await page.getByRole("navigation", { name: "管理后台导航" }).getByRole("button", { name: /视频与申诉/ }).click();
  } else await page.locator(".admin-sidebar").getByRole("button", { name: /视频与申诉/ }).click();
  await page.getByRole("button", { name: /待处理申诉/ }).click();
  await expect(page.getByRole("heading", { name: "待复查申诉" })).toBeVisible();
}

async function openApproval(page: Page) {
  await page.getByRole("button", { name: "通过申诉", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.getByRole("heading", { name: "核定申诉积分" })).toBeVisible();
}

test("locked rule preview and confirmation match the actual credit; stale confirmation fails safely", async ({ page }, info) => {
  const { video, appeal } = await seedAppeal(true);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openAppeals(page, info);
  await openApproval(page);
  await expect(page.getByRole("dialog")).toContainText("规则计算为 50 分，上限 5000 分");
  await expect(page.getByRole("spinbutton")).toHaveValue("");
  await page.getByRole("button", { name: "确认通过", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("基础积分入账 50 分");
  await expectNoHorizontalOverflow(page);
  const buttons = page.getByRole("dialog").getByRole("button");
  for (const button of await buttons.all()) await expect(button).toBeInViewport();
  await page.screenshot({ path: path.join(process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? info.outputDir, `rule-confirm-${info.project.name}.png`) });
  // The server rejects changing metadata after the exact amount was shown for confirmation.
  await db.videoSubmission.update({ where: { id: video.id }, data: { likes: 1501 } });
  await page.getByRole("button", { name: "确认通过并入账", exact: true }).click();
  await expect(page.locator(".admin-global-feedback")).toContainText("计算依据已变化");
  expect(await db.pointLedger.count({ where: { referenceId: video.id } })).toBe(0);
  await page.reload();
  if (!(await page.getByRole("heading", { name: "待复查申诉" }).isVisible())) {
    if (info.project.name.includes("mobile")) {
      await page.getByRole("button", { name: "打开菜单" }).click();
      await page.getByRole("navigation", { name: "管理后台导航" }).getByRole("button", { name: /视频与申诉/ }).click();
    } else await page.locator(".admin-sidebar").getByRole("button", { name: /视频与申诉/ }).click();
    await page.getByRole("button", { name: /待处理申诉/ }).click();
  }
  await openApproval(page);
  await expect(page.getByRole("dialog")).toContainText("规则计算为 750 分");
  await page.getByRole("button", { name: "确认通过", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("基础积分入账 750 分");
  await page.getByRole("button", { name: "确认通过并入账", exact: true }).click();
  await expect(page.getByText("暂无待复查申诉")).toBeVisible();
  expect(await db.pointLedger.findMany({ where: { referenceId: video.id, type: "VIDEO_REWARD" }, select: { amount: true } })).toEqual([{ amount: 750 }]);
  expect((await db.videoAppeal.findUniqueOrThrow({ where: { id: appeal.id } })).reviewedById).toBe(adminId);
  expect(pageErrors).toEqual([]);
});

test("legacy records show unknown historical rule, preserve optional input and reject empty rejection", async ({ page }, info) => {
  const { video } = await seedAppeal(false);
  await openAppeals(page, info);
  expect(await db.videoPointRuleSnapshot.count({ where: { videoId: video.id } })).toBe(0);
  await page.getByRole("button", { name: "驳回申诉", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认驳回", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "取消操作", exact: true }).click();
  await openApproval(page);
  await expect(page.getByRole("dialog")).toContainText("没有保存原审核规则");
  await page.getByRole("button", { name: "确认通过", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("金额尚未确定");
  await expect(page.getByRole("dialog")).not.toContainText("入账 0 分");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? info.outputDir, `rule-legacy-${info.project.name}.png`) });
  await page.getByRole("button", { name: "返回修改", exact: true }).click();
  expect(await db.pointLedger.count({ where: { referenceId: video.id } })).toBe(0);
  expect(await db.videoPointRuleSnapshot.count({ where: { videoId: video.id } })).toBe(0);
});

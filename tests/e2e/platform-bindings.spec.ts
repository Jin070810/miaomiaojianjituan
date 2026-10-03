import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { db } from "@/lib/db";
import { cleanupWeeklyChallengeE2E, e2eIds, expectNoHorizontalOverflow, login, seedWeeklyChallengeE2E } from "./weekly-challenge-fixture";

test.beforeAll(async () => { await seedWeeklyChallengeE2E(); });
test.afterAll(async () => { await cleanupWeeklyChallengeE2E(); await db.$disconnect(); });

async function screenshot(page: import("@playwright/test").Page, name: string) {
  const directory = path.join(process.env.PLAYWRIGHT_EVIDENCE_DIR ?? os.tmpdir(), "miaomiao-platform-bindings");
  await fs.mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name), fullPage: true });
}

test("member challenge, administrator proof, appeal credit and revocation remain consistent", async ({ page, browser }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const user = await db.user.findUniqueOrThrow({ where: { kuaishouId: e2eIds.member } });
  const uid = `e2e_${randomUUID()}`;
  const video = await db.videoSubmission.create({ data: { userId: user.id, sourceKind: "long-link", sourceUrl: "https://www.kuaishou.com/short-video/123", requestUrl: "https://www.kuaishou.com/short-video/123", photoId: `proof_${randomUUID()}`, status: "REJECTED", likes: 250, publishedAt: new Date(), metadataFetchedAt: new Date(), fetchedAuthorUid: uid, authorEvidenceVersion: 1, fetchedOwner: "测试作者", matchedOwner: false, submittedNickname: "同名不能证明归属", idempotencyKey: randomUUID() } });
  await login(page, e2eIds.member);
  await page.goto("/account-bindings");
  await expect(page).toHaveTitle(/平台账号验证/);
  await expect(page.getByRole("heading", { name: "平台账号验证", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "生成验证挑战" })).toBeDisabled();
  await page.getByLabel("选择自己的作品").selectOption(video.id);
  await page.getByRole("button", { name: "生成验证挑战" }).click();
  await expect(page.getByText("验证挑战已生成", { exact: false })).toBeVisible();
  const request = await db.platformBindingRequest.findFirstOrThrow({ where: { userId: user.id, authorUid: uid } });
  await expect(page.getByText(request.challenge, { exact: true })).toBeVisible();
  expect((await page.request.get("/api/admin/platform-bindings")).status()).toBe(403);
  await expectNoHorizontalOverflow(page);
  await screenshot(page, `member-challenge-${testInfo.project.name}.png`);
  const adminContext = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: page.viewportSize()! });
  try {
    const adminPage = await adminContext.newPage();
    adminPage.on("pageerror", (error) => errors.push(error.message));
    await login(adminPage, e2eIds.admin);
    await adminPage.goto("/admin/platform-bindings");
    await expect(adminPage).toHaveTitle(/账号归属核验/);
    const list = await (await adminPage.request.get("/api/admin/platform-bindings")).json();
    expect(JSON.stringify(list)).not.toContain(request.challenge);
    const card = adminPage.locator("article").filter({ hasText: uid });
    await card.getByText("核验此申请", { exact: true }).click();
    const approve = card.getByRole("button", { name: "确认账号控制权并绑定" });
    await expect(approve).toBeDisabled();
    await card.getByLabel("从平台账号实际取得的完整挑战码").fill("MM-abcdefghijklmnopqrstuvwx");
    await card.getByLabel("核验证据说明").fill("这是隔离环境的合成验收：模拟核对实际平台 UID 并收到本次挑战码，不代表真实平台验证。");
    await card.getByRole("checkbox").check();
    await approve.click();
    await expect(card.getByRole("alert")).toContainText("挑战码");
    await card.getByLabel("从平台账号实际取得的完整挑战码").fill(request.challenge);
    await expectNoHorizontalOverflow(adminPage);
    await screenshot(adminPage, `admin-proof-${testInfo.project.name}.png`);
    await approve.click();
    await expect(adminPage.getByRole("status").filter({ hasText: "处理完成" })).toBeVisible();
    await expect.poll(async () => (await db.platformBindingRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("APPROVED");
    await page.getByRole("button", { name: "刷新验证状态" }).click();
    await expect(page.getByText("核验已通过", { exact: false })).toBeVisible();
    const origin = new URL(page.url()).origin;
    const appealResponse = await page.request.post(`/api/videos/${video.id}/appeal`, { headers: { origin, "idempotency-key": randomUUID() }, data: { reason: "账号验证已完成，请复查原提交记录" } });
    expect(appealResponse.status()).toBe(201);
    const { appeal } = await appealResponse.json();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await adminPage.request.post(`/api/admin/video-appeals/${appeal.id}`, { headers: { origin }, data: { action: "approve", points: 50, reason: "合成验收：作者绑定与作品已核对" } });
      expect(result.status()).toBe(200);
    }
    expect(await db.pointLedger.count({ where: { referenceId: video.id, type: "VIDEO_REWARD" } })).toBe(1);
    await adminPage.getByLabel("申请状态").selectOption("APPROVED");
    const approvedCard = adminPage.locator("article").filter({ hasText: uid });
    await approvedCard.getByText("撤销此账号绑定", { exact: true }).click();
    await approvedCard.getByLabel("撤销原因").fill("合成验收：模拟账号失去控制");
    await approvedCard.getByRole("button", { name: "确认撤销绑定" }).click();
    await expect(adminPage.getByText("绑定已撤销", { exact: false })).toBeVisible();
    expect((await db.videoSubmission.findUniqueOrThrow({ where: { id: video.id } })).status).toBe("APPROVED");
    expect(await db.pointLedger.count({ where: { referenceId: video.id, type: "VIDEO_REWARD" } })).toBe(1);
    await expectNoHorizontalOverflow(adminPage);
  } finally { await adminContext.close(); }
  expect(errors).toEqual([]);
});

test("binding page exposes loading, error retry, empty and disabled states", async ({ page }, testInfo) => {
  await login(page, e2eIds.noTaskMember);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/platform-bindings", async (route) => {
    await gate;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "测试服务暂时不可用" }) });
  });
  await page.goto("/account-bindings");
  await expect(page.getByText("正在加载账号与作品…")).toBeVisible();
  await expect(page.getByRole("button", { name: "加载中…" })).toBeDisabled();
  release();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("暂时不可用");
  await page.unroute("**/api/platform-bindings");
  await page.getByRole("button", { name: "刷新验证状态" }).click();
  await expect(page.getByText("尚未绑定平台账号。")).toBeVisible();
  await expect(page.getByText("暂无验证申请。")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成验证挑战" })).toBeDisabled();
  await expectNoHorizontalOverflow(page);
  await screenshot(page, `member-empty-${testInfo.project.name}.png`);
});

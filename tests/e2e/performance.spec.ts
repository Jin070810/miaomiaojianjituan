import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { db } from "@/lib/db";
import { cleanupWeeklyChallengeE2E, e2eIds, expectNoHorizontalOverflow, login, seedWeeklyChallengeE2E } from "./weekly-challenge-fixture";
const directory = process.env.PERFORMANCE_EVIDENCE_DIR;
test.beforeAll(async () => { await seedWeeklyChallengeE2E(); });
test.afterAll(async () => { await cleanupWeeklyChallengeE2E(); await db.$disconnect(); });

test("real metrics, anonymous RUM, administrator dashboard and trace correlation", async ({ page }, testInfo) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  const samples: Array<{ body: Record<string, unknown>; cookie: string | undefined }> = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/performance") && request.method() === "POST") {
      void request.allHeaders().then((headers) => samples.push({ body: request.postDataJSON(), cookie: headers.cookie }));
    }
  });
  const loginResponse = page.waitForResponse((response) => response.url().endsWith("/api/auth/login") && response.request().method() === "POST");
  await login(page, e2eIds.admin);
  const response = await loginResponse;
  const trace = response.headers()["x-request-id"];
  expect(trace).toMatch(/^[0-9a-f-]{36}$/);
  expect(await db.auditLog.count({ where: { requestId: trace } })).toBeGreaterThan(0);
  const me = await page.request.get("/api/me");
  expect(me.status()).toBe(200); expect(me.headers()["server-timing"]).toMatch(/^app;dur=/);
  await expect.poll(async () => {
    const snapshot = await (await page.request.get("/api/admin/performance")).json();
    return snapshot.rows.some((row: { key: string; count: number }) => row.key === "me_get" && row.count > 0);
  }).toBe(true);
  const acceptedRum = page.waitForResponse((response) => response.url().endsWith("/api/performance") && response.request().method() === "POST" && response.status() === 204);
  await page.goto("/admin/performance");
  expect((await acceptedRum).status()).toBe(204);
  await expect(page.getByRole("heading", { name: "性能观测", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "接口耗时" }).getByRole("heading", { name: "成员身份" })).toBeVisible();
  await expect.poll(() => samples.filter((sample) => sample.body.page === "admin").length).toBeGreaterThan(0);
  for (const sample of samples) {
    expect(Object.keys(sample.body).sort()).toEqual(["name", "page", "value", "viewport"]);
    expect(sample.cookie).toBeUndefined();
  }
  const snapshot = await (await page.request.get("/api/admin/performance")).json();
  expect(JSON.stringify(snapshot)).not.toContain(e2eIds.admin);
  await expectNoHorizontalOverflow(page);
  if (directory) {
    await fs.mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, "performance-" + testInfo.project.name + ".png"), fullPage: true });
    await fs.writeFile(path.join(directory, "samples-" + testInfo.project.name + ".json"), JSON.stringify({ snapshot, sampleBodies: samples.map((sample) => sample.body) }, null, 2));
  }
  await page.request.post("/api/auth/logout");
  expect((await page.request.get("/api/admin/performance")).status()).toBe(403);
});

test("loading, retry, empty and unavailable states remain usable", async ({ page }, testInfo) => {
  await login(page, e2eIds.admin);
  const empty = { status: "ok", rows: [], resources: { web: null, worker: null }, droppedInThisProcess: 0, windowStart: new Date().toISOString(), windowEnd: new Date().toISOString() };
  let mode = "loading";
  let release: (() => void) | undefined;
  await page.route("**/api/admin/performance", async (route) => {
    if (mode === "loading") await new Promise<void>((resolve) => { release = resolve; });
    if (mode === "failed") return route.fulfill({ status: 503, body: "{}" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...empty, status: mode === "unavailable" ? "unavailable" : "ok" }) });
  });
  await page.goto("/admin/performance");
  await expect(page.getByRole("button", { name: "正在加载…" })).toBeDisabled();
  mode = "failed"; release?.();
  await expect(page.locator("main").getByRole("alert")).toContainText("暂时无法加载");
  mode = "empty";
  await page.getByRole("button", { name: "刷新数据" }).click();
  await expect(page.getByText("暂无接口样本", { exact: true })).toBeVisible();
  await expect(page.getByText("暂无新鲜采样")).toHaveCount(2);
  mode = "unavailable";
  await page.getByRole("button", { name: "刷新数据" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("无法判断性能");
  await expectNoHorizontalOverflow(page);
  if (directory) await page.screenshot({ path: path.join(directory, "unavailable-" + testInfo.project.name + ".png"), fullPage: true });
  await page.unrouteAll({ behavior: "wait" });
  await page.request.post("/api/auth/logout");
  await login(page, e2eIds.noTaskMember);
  expect((await page.request.get("/api/admin/performance")).status()).toBe(403);
  await page.goto("/admin/performance");
  await expect(page).toHaveURL(/\/$/);
});

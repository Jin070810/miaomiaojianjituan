import crypto from "node:crypto";
import { expect, test } from "@playwright/test";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/security";

const identity = `projection-ui-${crypto.randomUUID()}`;
const password = "Projection-UI-test-password";
let userId: string;
test.beforeAll(async () => {
  const user = await db.user.create({ data: { kuaishouId: identity, nickname: "成长档案测试", passwordHash: await hashPassword(password), account: { create: { balance: 0 } } } });
  userId = user.id;
});
test.afterAll(async () => {
  if (userId) {
    await db.notification.deleteMany({ where: { userId } });
    await db.auditLog.deleteMany({ where: { actorId: userId } });
    await db.session.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  }
  await db.$disconnect();
});

const ready = {
  projection: { state: "ready", initialized: true, delayed: false, calculatedAt: new Date().toISOString() },
  profile: { experience: 0, level: 1, name: "剪辑新芽", nextLevel: { level: 2, name: "成长剪辑师", minimumExperience: 500 } },
  goal: { monthStart: new Date().toISOString(), baselineVideos: 0, baselineEngagement: 0, targetVideos: 1, targetEngagement: 100, completedAt: null, progress: { videos: 0, engagement: 0 } },
  achievements: [], highlights: [], reviews: [],
};
async function login(page: import("@playwright/test").Page) {
  const response = await page.request.post("/api/auth/login", { data: { kuaishouId: identity, password }, headers: { "x-real-ip": "198.51.100.144" } });
  expect(response.status()).toBe(200);
  await page.goto("/");
}
async function noOverflow(page: import("@playwright/test").Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("initial archive shows pending instead of zero statistics and can refresh to ready", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let pending = true;
  let hold: Promise<void> | null = null;
  let release!: () => void;
  await page.route("**/api/member/achievements", async (route) => {
    if (hold) await hold;
    await route.fulfill({ json: pending ? { ...ready, projection: { ...ready.projection, state: "pending", initialized: false } } : ready });
  });
  await login(page);
  const initial = page.getByLabel("成长档案更新中");
  await expect(initial.getByRole("heading", { name: "成长档案更新中" })).toBeVisible();
  await expect(initial).not.toContainText("0 经验");
  await initial.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const initialRefresh = initial.getByRole("button", { name: "刷新档案" });
  expect(await initialRefresh.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
  await noOverflow(page);
  await page.screenshot({ path: `output/playwright/achievement-pending-${info.project.name}.png` });
  pending = false;
  hold = new Promise<void>((resolve) => { release = resolve; });
  await initial.getByRole("button", { name: "刷新档案" }).click();
  await expect(page.getByLabel("成长与成就正在加载")).toBeVisible();
  release();
  await expect(page.getByRole("button", { name: "查看成长与成就" })).toBeVisible();
  await page.getByRole("button", { name: "查看成长与成就" }).click();
  await expect(page.getByRole("heading", { name: "Lv.1 剪辑新芽" })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("delayed archive keeps previous data and recovers after a failed refresh", async ({ page }, info) => {
  let mode: "pending" | "error" | "ready" = "pending";
  await page.route("**/api/member/achievements", async (route) => {
    if (mode === "error") return route.fulfill({ status: 503, json: { error: "档案读取暂时失败" } });
    await route.fulfill({ json: mode === "pending" ? { ...ready, profile: { ...ready.profile, experience: 240 }, projection: { ...ready.projection, state: "pending", delayed: true } } : ready });
  });
  await login(page);
  await expect(page.getByText("240 经验", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "查看成长与成就" }).click();
  await expect(page.getByRole("status")).toContainText("档案更新稍有延迟");
  const refresh = page.getByRole("button", { name: "刷新档案" });
  expect((await refresh.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await noOverflow(page);
  await page.screenshot({ path: `output/playwright/achievement-delayed-${info.project.name}.png`, fullPage: true });
  mode = "error";
  await refresh.click();
  await expect(page.getByRole("alert").filter({ hasText: "档案读取暂时失败" })).toBeVisible();
  mode = "ready";
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.getByText("通过第一条作品后，这里会收藏你的高光。")).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await noOverflow(page);
});

test("staging Worker materializes source changes while archive requests stay read-only", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_SKIP_WEBSERVER !== "1", "Requires the real staging Worker container");
  await login(page);
  const video = await db.videoSubmission.create({ data: { userId, sourceUrl: `https://v.kuaishou.com/${identity}`, requestUrl: "https://v.kuaishou.com/projection-staging", sourceKind: "short-link",
    submittedNickname: "成长档案测试", status: "APPROVED", likes: 299, views: 2999, commentCount: 3, idempotencyKey: identity } });
  try {
    await expect.poll(async () => {
      const response = await page.request.get("/api/member/achievements");
      if (response.status() !== 200) return false;
      const result = await response.json();
      return result.projection.state === "ready" && result.profile.experience === 119 && result.goal.progress.videos === 1;
    }, { timeout: 30_000, intervals: [500, 1000, 2000] }).toBe(true);
    const before = await db.memberGrowthProfile.findUniqueOrThrow({ where: { userId } });
    const responses = await Promise.all(Array.from({ length: 10 }, () => page.request.get("/api/member/achievements")));
    expect(responses.every((response) => response.status() === 200)).toBe(true);
    expect(await db.memberGrowthProfile.findUniqueOrThrow({ where: { userId } })).toEqual(before);
    await db.videoSubmission.update({ where: { id: video.id }, data: { status: "REVOKED" } });
    await expect.poll(async () => {
      const response = await page.request.get("/api/member/achievements");
      if (response.status() !== 200) return false;
      const result = await response.json();
      return result.projection.state === "ready" && result.profile.experience === 0;
    }, { timeout: 30_000, intervals: [500, 1000, 2000] }).toBe(true);
  } finally { await db.videoSubmission.delete({ where: { id: video.id } }); }
});

test("pending archive refreshes with backoff and stops after three attempts", async ({ page }) => {
  let requests = 0;
  await page.clock.install();
  await page.route("**/api/member/achievements", async (route) => {
    requests += 1;
    await route.fulfill({ json: { ...ready, projection: { ...ready.projection, state: "pending", initialized: false } } });
  });
  await login(page);
  await expect(page.getByLabel("成长档案更新中")).toBeVisible();
  expect(requests).toBe(1);
  for (const [delay, expected] of [[5_100, 2], [10_100, 3], [20_100, 4]]) {
    await page.clock.runFor(delay);
    await expect.poll(() => requests).toBe(expected);
    await expect(page.getByLabel("成长档案更新中")).toBeVisible();
  }
  await page.clock.runFor(120_000);
  expect(requests).toBe(4);
});

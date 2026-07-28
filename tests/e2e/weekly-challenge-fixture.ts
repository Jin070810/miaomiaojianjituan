import argon2 from "argon2";
import { db } from "@/lib/db";
import { nextShanghaiWeekBounds, shanghaiWeekBounds } from "@/lib/weekly-challenges";

export const e2ePassword = "WeeklyE2E-2026";
export const e2eIds = {
  member: "weekly-e2e-member",
  noTaskMember: "weekly-e2e-no-task",
  admin: "weekly-e2e-admin",
};

export async function seedWeeklyChallengeE2E() {
  if (!process.env.DATABASE_URL?.includes("schema=")) {
    throw new Error("E2E 必须使用显式指定 schema 的测试数据库");
  }
  await cleanupWeeklyChallengeE2E();
  const passwordHash = await argon2.hash(e2ePassword);
  const [member, noTaskMember, admin] = await Promise.all([
    db.user.create({
      data: {
        kuaishouId: e2eIds.member,
        nickname: "周挑战测试成员",
        passwordHash,
        role: "MEMBER",
        active: true,
        account: { create: { balance: 0 } },
      },
    }),
    db.user.create({
      data: {
        kuaishouId: e2eIds.noTaskMember,
        nickname: "暂无任务成员",
        passwordHash,
        role: "MEMBER",
        active: true,
        account: { create: { balance: 0 } },
      },
    }),
    db.user.create({
      data: {
        kuaishouId: e2eIds.admin,
        nickname: "周挑战测试管理员",
        passwordHash,
        role: "ADMIN",
        active: true,
        account: { create: { balance: 0 } },
      },
    }),
  ]);
  const current = shanghaiWeekBounds();
  const next = nextShanghaiWeekBounds();
  const period = await db.weeklyChallengePeriod.create({
    data: {
      periodStart: current.start,
      periodEnd: current.end,
      claimEndsAt: current.claimEndsAt,
      status: "ACTIVE",
      model: "e2e-mock-model",
      promptVersion: "weekly-challenge-v1",
      audienceSnapshot: [member.id, noTaskMember.id],
      audienceCount: 2,
      activatedAt: new Date(),
      assignments: {
        create: {
          userId: member.id,
          type: "VIDEO_COUNT",
          baselineVideoCount: 1,
          baselineLikes: 500,
          weeklyVideoCounts: [0, 1, 1, 2],
          weeklyLikeSums: [0, 500, 600, 800],
          targetVideoCount: 2,
          rewardPoints: 120,
          difficultyScore: 135,
          title: "完成 2 条稳定输出",
          description: "本周完成 2 条审核通过的视频",
          aiReason: "依据最近两周逐周数据，本周提高综合目标。",
        },
      },
    },
    include: { assignments: true },
  });
  await db.weeklyChallengePeriod.create({
    data: {
      periodStart: next.start,
      periodEnd: next.end,
      claimEndsAt: next.claimEndsAt,
      status: "FAILED",
      model: "e2e-mock-model",
      promptVersion: "weekly-challenge-v1",
      audienceSnapshot: [member.id, noTaskMember.id],
      audienceCount: 2,
      failureReason: "模拟批次缺失成员，整周未发布",
    },
  });
  await db.videoSubmission.create({
    data: {
      userId: member.id,
      sourceUrl: "https://v.kuaishou.com/weekly-e2e-progress",
      requestUrl: "https://v.kuaishou.com/weekly-e2e-progress",
      sourceKind: "short-link",
      status: "APPROVED",
      likes: 560,
      points: 50,
      submittedNickname: member.nickname,
      submittedAt: new Date(current.start.getTime() + 60_000),
      idempotencyKey: "weekly-e2e-progress-video",
    },
  });
  await db.systemSetting.upsert({
    where: { key: "WEEKLY_CHALLENGES" },
    create: { key: "WEEKLY_CHALLENGES", enabled: true },
    update: { enabled: true, updatedById: null },
  });
  return { member, noTaskMember, admin, period, assignment: period.assignments[0] };
}

export async function cleanupWeeklyChallengeE2E() {
  const users = await db.user.findMany({
    where: { kuaishouId: { in: Object.values(e2eIds) } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  const periods = await db.weeklyChallengePeriod.findMany({
    where: { model: "e2e-mock-model" },
    select: { id: true },
  });
  const periodIds = periods.map((period) => period.id);
  if (userIds.length) {
    await db.notification.deleteMany({ where: { userId: { in: userIds } } });
    await db.session.deleteMany({ where: { userId: { in: userIds } } });
    await db.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: userIds } },
          { entity: { in: ["WeeklyChallengePeriod", "WeeklyChallengeAssignment", "WeeklyRaceWinner"] } },
        ],
      },
    });
  }
  if (periodIds.length) await db.weeklyChallengePeriod.deleteMany({ where: { id: { in: periodIds } } });
  if (userIds.length) {
    const accounts = await db.pointAccount.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    await db.pointLedger.deleteMany({ where: { accountId: { in: accounts.map((account) => account.id) } } });
    await db.videoSubmission.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

export async function login(page: import("@playwright/test").Page, kuaishouId: string) {
  const testIp = `198.51.${100 + Math.floor(Math.random() * 50)}.${1 + Math.floor(Math.random() * 253)}`;
  await page.setExtraHTTPHeaders({ "x-real-ip": testIp });
  await page.goto("/login");
  await page.getByLabel("快手 ID").fill(kuaishouId);
  await page.getByLabel("密码", { exact: true }).fill(e2ePassword);
  const loginResponse = page.waitForResponse((response) => response.url().endsWith("/api/auth/login") && response.request().method() === "POST");
  await page.getByRole("button", { name: "进入剪辑团" }).click();
  const response = await loginResponse;
  const result = await response.json();
  if (!response.ok()) throw new Error(`E2E 登录失败：${result.error ?? response.status()}`);
  await page.goto(result.user?.role === "ADMIN" ? "/admin" : "/");
}

export async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (dimensions.scrollWidth > dimensions.clientWidth) {
    throw new Error(`页面横向溢出：${dimensions.scrollWidth} > ${dimensions.clientWidth}`);
  }
}

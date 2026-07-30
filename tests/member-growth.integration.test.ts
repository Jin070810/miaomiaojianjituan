import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getAdminMemberGrowth, getMemberGrowth, growthWindows } from "@/lib/member-growth";
import { periodBounds } from "@/lib/rankings";

const enabled = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("member growth database integration", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  // Keep both the current and previous weekly windows in one calendar month so
  // the member-facing monthly highlight assertion cannot depend on wall-clock time.
  const reference = new Date("2180-05-21T04:00:00.000Z");
  const windows = growthWindows(reference);
  const week = periodBounds("week", reference);
  const userIds: string[] = [];
  let periodId = "";
  let memberAId = "";
  let memberBId = "";

  beforeAll(async () => {
    const users = await Promise.all([
      db.user.create({ data: { kuaishouId: `growth-a-${suffix}`, nickname: "成长甲", passwordHash: "test" } }),
      db.user.create({ data: { kuaishouId: `growth-b-${suffix}`, nickname: "成长乙", passwordHash: "test" } }),
      db.user.create({ data: { kuaishouId: `growth-inactive-${suffix}`, nickname: "停用成员", passwordHash: "test", active: false } }),
      db.user.create({ data: { kuaishouId: `growth-admin-${suffix}`, nickname: "成长管理员", passwordHash: "test", role: "ADMIN" } }),
    ]);
    userIds.push(...users.map((user) => user.id));
    [memberAId, memberBId] = users.map((user) => user.id);
    const at = (start: Date, hours: number) => new Date(start.getTime() + hours * 60 * 60 * 1000);
    await db.videoSubmission.createMany({
      data: [
        { userId: memberAId, sourceUrl: "https://v.kuaishou.com/growth-a-current", requestUrl: "https://v.kuaishou.com/growth-a-current", sourceKind: "short-link", status: "APPROVED", likes: 1200, points: 600, submittedNickname: "成长甲", submittedAt: at(windows.currentWeek.start, 2), idempotencyKey: `growth-a-current-${suffix}` },
        { userId: memberAId, sourceUrl: "https://v.kuaishou.com/growth-a-rejected", requestUrl: "https://v.kuaishou.com/growth-a-rejected", sourceKind: "short-link", status: "REJECTED", likes: 5000, points: 5000, submittedNickname: "成长甲", submittedAt: at(windows.currentWeek.start, 3), idempotencyKey: `growth-a-rejected-${suffix}` },
        { userId: memberAId, sourceUrl: "https://v.kuaishou.com/growth-a-previous", requestUrl: "https://v.kuaishou.com/growth-a-previous", sourceKind: "short-link", status: "APPROVED", likes: 400, points: 200, submittedNickname: "成长甲", submittedAt: at(windows.previousWeekSameWindow.start, 2), idempotencyKey: `growth-a-previous-${suffix}` },
        { userId: memberBId, sourceUrl: "https://v.kuaishou.com/growth-b-current", requestUrl: "https://v.kuaishou.com/growth-b-current", sourceKind: "short-link", status: "APPROVED", likes: 800, points: 400, submittedNickname: "成长乙", submittedAt: at(windows.currentWeek.start, 4), idempotencyKey: `growth-b-current-${suffix}` },
        { userId: users[2].id, sourceUrl: "https://v.kuaishou.com/growth-inactive", requestUrl: "https://v.kuaishou.com/growth-inactive", sourceKind: "short-link", status: "APPROVED", likes: 9999, points: 4999, submittedNickname: "停用成员", submittedAt: at(windows.currentWeek.start, 5), idempotencyKey: `growth-inactive-${suffix}` },
        { userId: users[3].id, sourceUrl: "https://v.kuaishou.com/growth-admin", requestUrl: "https://v.kuaishou.com/growth-admin", sourceKind: "short-link", status: "APPROVED", likes: 9999, points: 4999, submittedNickname: "成长管理员", submittedAt: at(windows.currentWeek.start, 6), idempotencyKey: `growth-admin-${suffix}` },
      ],
    });
    const period = await db.weeklyChallengePeriod.create({
      data: {
        periodStart: week.start,
        periodEnd: week.end,
        claimEndsAt: new Date(week.end.getTime() + 3 * 24 * 60 * 60 * 1000),
        status: "ACTIVE",
        model: `growth-test-${suffix}`,
        promptVersion: "growth-test",
        audienceSnapshot: [memberAId, memberBId],
        audienceCount: 2,
        assignments: {
          create: [
            {
              userId: memberAId,
              type: "COMBINED",
              status: "CLAIMED",
              weeklyVideoCounts: [0, 0, 0, 1],
              weeklyLikeSums: [0, 0, 0, 1200],
              targetVideoCount: 1,
              targetLikes: 1000,
              rewardPoints: 300,
              difficultyScore: 50,
              title: "成长任务",
              description: "测试",
              aiReason: "测试",
            },
            {
              userId: memberBId,
              type: "COMBINED",
              status: "COMPLETED",
              weeklyVideoCounts: [0, 0, 0, 1],
              weeklyLikeSums: [0, 0, 0, 800],
              targetVideoCount: 1,
              targetLikes: 800,
              rewardPoints: 300,
              difficultyScore: 50,
              title: "成长任务",
              description: "测试",
              aiReason: "测试",
            },
          ],
        },
      },
    });
    periodId = period.id;
  });

  afterAll(async () => {
    if (periodId) await db.weeklyChallengePeriod.deleteMany({ where: { id: periodId } });
    await db.videoSubmission.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it("isolates member data and excludes rejected videos", async () => {
    const growth = await getMemberGrowth(memberAId, reference);
    expect(growth.currentWeek).toMatchObject({ approvedVideos: 1, likes: 1200, videoPoints: 600, averageLikes: 1200 });
    expect(growth.previousWeekSameWindow).toMatchObject({ approvedVideos: 1, likes: 400, videoPoints: 200 });
    expect(growth.delta).toEqual({ approvedVideos: 0, likes: 800, videoPoints: 400 });
    expect(growth.topVideos).toHaveLength(2);
    expect(growth.topVideos[0].sourceUrl).toContain("growth-a-current");
  });

  it("counts only active members and exposes read-only challenge participation", async () => {
    const growth = await getAdminMemberGrowth(reference);
    expect(growth.activeMembers).toBeGreaterThanOrEqual(2);
    expect(growth.currentWeek).toEqual({
      submitters: 2,
      approvedSubmitters: 2,
      approvedVideos: 2,
      likes: 2000,
      videoPoints: 1000,
    });
    expect(growth.previousWeekSameWindow).toEqual({
      submitters: 1,
      approvedSubmitters: 1,
      approvedVideos: 1,
      likes: 400,
      videoPoints: 200,
    });
    expect(growth.challenge).toEqual({ covered: 2, completed: 2, claimed: 1 });
  });
});

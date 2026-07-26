import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  generateWeeklyChallengePeriod,
  weeklyChallengeGenerationInternals,
} from "@/lib/weekly-challenge-generation";
import {
  activateAndCloseWeeklyChallenges,
  claimWeeklyChallenge,
  shanghaiWeekBounds,
} from "@/lib/weekly-challenges";
import { creditVideoReward, revokeVideoReward } from "@/lib/points";

const enabled = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("AI 周挑战数据库事务", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const generatedPeriodStart = new Date("2031-01-05T16:00:00.000Z");
  const failedPeriodStart = new Date("2031-01-12T16:00:00.000Z");
  const heartbeatPeriodStart = new Date("2031-02-16T16:00:00.000Z");
  const correctedPeriodStart = new Date("2031-02-23T16:00:00.000Z");
  const providerFailureCases = [
    ["http-429", new Date("2031-01-19T16:00:00.000Z")],
    ["http-500", new Date("2031-01-26T16:00:00.000Z")],
    ["invalid-json", new Date("2031-02-02T16:00:00.000Z")],
    ["timeout", new Date("2031-02-09T16:00:00.000Z")],
  ] as const;
  const userIds: string[] = [];
  const periodIds: string[] = [];
  let server: http.Server;
  let streamedRequestCount = 0;
  let responseMode: "valid" | "missing-member" | "new-member-like-sum-once" | "http-429" | "http-500" | "invalid-json" | "timeout" = "valid";

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        try {
          if (responseMode === "http-429" || responseMode === "http-500") {
            response.writeHead(responseMode === "http-429" ? 429 : 500, { "content-type": "application/json" });
            response.end(JSON.stringify({ error: "mock provider failure" }));
            return;
          }
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            stream?: boolean;
            messages: Array<{ role: string; content: string }>;
          };
          if (body.stream) streamedRequestCount += 1;
          const prompt = JSON.parse(body.messages.find((message) => message.role === "user")?.content ?? "{}") as {
            members: Array<{
              memberRef: string;
              allowedTypes: string[];
              allowedTargets: { minimumVideos: number; minimumLikes: number };
            }>;
            retryCorrection?: { previousValidationError: string };
          };
          const selected = responseMode === "missing-member" ? prompt.members.slice(1) : prompt.members;
          const tasks = selected.map((member) => {
            const invalidNewMember = responseMode === "new-member-like-sum-once"
              && !prompt.retryCorrection
              && !member.allowedTypes.includes("LIKE_SUM");
            return {
              memberRef: member.memberRef,
              type: invalidNewMember ? "LIKE_SUM" : "VIDEO_COUNT",
              title: invalidNewMember ? "新人点赞提升" : "本周稳定输出",
              description: invalidNewMember ? "完成本周审核通过视频点赞目标" : "完成本周审核通过视频数量目标",
              reason: "依据匿名四周数量趋势生成",
              targetVideoCount: invalidNewMember ? 0 : member.allowedTargets.minimumVideos,
              targetLikes: invalidNewMember ? member.allowedTargets.minimumLikes : 0,
              rewardPoints: 1000,
            };
          });
          const send = () => {
            const content = responseMode === "invalid-json" ? "{" : JSON.stringify({ tasks });
            const splitAt = Math.floor(content.length / 2);
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(0, splitAt) } }] })}\n\n`);
            response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(splitAt) } }] })}\n\n`);
            response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 100 } })}\n\n`);
            response.end("data: [DONE]\n\n");
          };
          if (responseMode === "timeout") setTimeout(send, 100);
          else send();
        } catch (error) {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : "mock failure" }));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${address.port}`;
    process.env.DEEPSEEK_API_KEY = "mock-deepseek-key";
    process.env.DEEPSEEK_MODEL = "mock-weekly-challenge-model";
    process.env.DEEPSEEK_TIMEOUT_MS = "25";
    process.env.DEEPSEEK_RETRY_BASE_MS = "5";

    const stalePeriods = await db.weeklyChallengePeriod.findMany({
      where: { periodStart: { in: [
        generatedPeriodStart,
        failedPeriodStart,
        heartbeatPeriodStart,
        correctedPeriodStart,
        ...providerFailureCases.map((entry) => entry[1]),
      ] } },
      select: { id: true },
    });
    if (stalePeriods.length) {
      await db.auditLog.deleteMany({
        where: { entity: "WeeklyChallengePeriod", entityId: { in: stalePeriods.map((period) => period.id) } },
      });
      await db.weeklyChallengePeriod.deleteMany({ where: { id: { in: stalePeriods.map((period) => period.id) } } });
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (periodIds.length) {
      await db.notification.deleteMany({
        where: {
          OR: [
            { entityType: "WeeklyChallengeAssignment" },
            { userId: { in: userIds } },
          ],
        },
      });
      await db.auditLog.deleteMany({
        where: {
          OR: [
            { entity: { in: ["WeeklyChallengePeriod", "WeeklyChallengeAssignment", "WeeklyRaceWinner"] }, entityId: { in: periodIds } },
            { actorId: { in: userIds } },
          ],
        },
      });
      await db.weeklyChallengePeriod.deleteMany({ where: { id: { in: periodIds } } });
    }
    const accounts = await db.pointAccount.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    });
    await db.pointLedger.deleteMany({ where: { accountId: { in: accounts.map((account) => account.id) } } });
    await db.videoSubmission.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.systemSetting.deleteMany({ where: { key: "WEEKLY_CHALLENGES" } });
    delete process.env.DEEPSEEK_BASE_URL;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_MODEL;
    delete process.env.DEEPSEEK_TIMEOUT_MS;
    delete process.env.DEEPSEEK_RETRY_BASE_MS;
    await db.$disconnect();
  });

  it("publishes tiered assignments only for members who submitted in the previous week", async () => {
    await db.user.createMany({
      data: Array.from({ length: 300 }, (_, index) => ({
        kuaishouId: `weekly-generation-${suffix}-${index}`,
        nickname: `生成成员${index}`,
        passwordHash: "test",
        role: "MEMBER" as const,
        active: true,
      })),
    });
    const users = await db.user.findMany({
      where: { kuaishouId: { startsWith: `weekly-generation-${suffix}-` } },
      select: { id: true },
    });
    userIds.push(...users.map((user) => user.id));
    const noRecentSubmissionUser = await db.user.create({
      data: {
        kuaishouId: `weekly-no-recent-submission-${suffix}`,
        nickname: "上周未投稿成员",
        passwordHash: "test",
        role: "MEMBER",
        active: true,
      },
    });
    userIds.push(noRecentSubmissionUser.id);
    const generationStarts = [
      generatedPeriodStart,
      failedPeriodStart,
      correctedPeriodStart,
      ...providerFailureCases.map((entry) => entry[1]),
    ];
    await db.videoSubmission.createMany({
      data: generationStarts.flatMap((periodStart, periodIndex) => users.map((user, userIndex) => ({
        userId: user.id,
        sourceUrl: `https://v.kuaishou.com/weekly-generation-${suffix}-${periodIndex}-${userIndex}`,
        requestUrl: `https://v.kuaishou.com/weekly-generation-${suffix}-${periodIndex}-${userIndex}`,
        sourceKind: "short-link",
        status: "APPROVED" as const,
        likes: 500,
        submittedNickname: `生成成员${userIndex}`,
        submittedAt: new Date(periodStart.getTime() - 24 * 60 * 60 * 1000),
        idempotencyKey: `weekly-generation-video-${suffix}-${periodIndex}-${userIndex}`,
      }))),
    });

    responseMode = "valid";
    const period = await generateWeeklyChallengePeriod({ periodStart: generatedPeriodStart });
    periodIds.push(period.id);
    const assignments = await db.weeklyChallengeAssignment.findMany({ where: { periodId: period.id } });
    expect(period.status).toBe("READY");
    expect(assignments).toHaveLength(300);
    expect(assignments.every((assignment) => assignment.targetLikes === null)).toBe(true);
    expect(streamedRequestCount).toBe(12);
    expect(assignments.reduce((sum, assignment) => sum + assignment.rewardPoints, 0)).toBeLessThanOrEqual(300_000);
    expect(assignments.every((assignment) =>
      Number.isInteger(assignment.rewardPoints)
      && assignment.rewardPoints >= 300
      && assignment.rewardPoints <= 1000
      && Array.isArray(assignment.rewardTiers)
      && assignment.rewardTiers.length === 3)).toBe(true);
    expect(await db.weeklyChallengeGenerationAttempt.count({
      where: { periodId: period.id, status: "SUCCEEDED" },
    })).toBe(12);
    const audit = await db.auditLog.findFirstOrThrow({
      where: {
        entity: "WeeklyChallengePeriod",
        entityId: period.id,
        action: "WEEKLY_CHALLENGE_PERIOD_GENERATED",
      },
    });
    expect(audit.afterValue).toMatchObject({
      audienceCount: 300,
      suggestedTotalRewards: 300_000,
      rewardBudget: 300_000,
      rewardBudgetAdjusted: false,
      adjustedAssignmentCount: 0,
      rewardPolicyVersion: "tiered-v1",
    });
  }, 30_000);

  it("marks the whole period failed when a batch omits a member", async () => {
    responseMode = "missing-member";
    await expect(generateWeeklyChallengePeriod({ periodStart: failedPeriodStart })).rejects.toThrow("重复或缺失");
    const period = await db.weeklyChallengePeriod.findUniqueOrThrow({ where: { periodStart: failedPeriodStart } });
    periodIds.push(period.id);
    expect(period.status).toBe("FAILED");
    expect(await db.weeklyChallengeAssignment.count({ where: { periodId: period.id } })).toBe(0);
    expect(await db.weeklyChallengeGenerationAttempt.count({
      where: { periodId: period.id, status: "FAILED" },
    })).toBe(3);
  }, 30_000);

  it("feeds business validation back to the model and upgrades failed-period metadata on retry", async () => {
    await db.user.update({
      where: { id: userIds[0] },
      data: { createdAt: new Date(correctedPeriodStart.getTime() - 3 * 24 * 60 * 60 * 1000) },
    });
    responseMode = "new-member-like-sum-once";
    const period = await generateWeeklyChallengePeriod({ periodStart: correctedPeriodStart });
    periodIds.push(period.id);

    const attempts = await db.weeklyChallengeGenerationAttempt.findMany({
      where: { periodId: period.id },
      orderBy: [{ batchNumber: "asc" }, { attemptNumber: "asc" }],
    });
    const failedAttempt = attempts.find((attempt) => attempt.status === "FAILED");
    expect(period).toMatchObject({
      status: "READY",
      model: "mock-weekly-challenge-model",
      promptVersion: "weekly-challenge-v3-tiered-rewards",
      rewardPolicyVersion: "tiered-v1",
    });
    expect(failedAttempt?.error).toContain("至少 2 条通过视频");
    expect(attempts.filter((attempt) => attempt.status === "FAILED")).toHaveLength(1);
    expect(attempts.find((attempt) =>
      attempt.batchNumber === failedAttempt?.batchNumber && attempt.status === "SUCCEEDED")?.promptHash)
      .not.toBe(failedAttempt?.promptHash);

    const assignment = await db.weeklyChallengeAssignment.findFirstOrThrow({
      where: { periodId: period.id, userId: userIds[0] },
    });
    expect(assignment.type).toBe("VIDEO_COUNT");
    expect(assignment.targetVideoCount).toBeGreaterThanOrEqual(2);

    await db.weeklyChallengePeriod.update({
      where: { periodStart: failedPeriodStart },
      data: { model: "legacy-model", promptVersion: "weekly-challenge-v1" },
    });
    responseMode = "valid";
    const retried = await generateWeeklyChallengePeriod({ periodStart: failedPeriodStart, retryFailed: true });
    expect(retried).toMatchObject({
      status: "READY",
      model: "mock-weekly-challenge-model",
      promptVersion: "weekly-challenge-v3-tiered-rewards",
      rewardPolicyVersion: "tiered-v1",
    });
  }, 30_000);

  it("refreshes only the active generation run lease", async () => {
    const generationRunId = `lease-${suffix}`;
    const staleHeartbeat = new Date("2020-01-01T00:00:00.000Z");
    const period = await db.weeklyChallengePeriod.create({
      data: {
        periodStart: heartbeatPeriodStart,
        periodEnd: new Date(heartbeatPeriodStart.getTime() + 7 * 24 * 60 * 60 * 1000),
        claimEndsAt: new Date(heartbeatPeriodStart.getTime() + 10 * 24 * 60 * 60 * 1000),
        status: "GENERATING",
        model: "mock",
        audienceSnapshot: [],
        audienceCount: 0,
        generationRunId,
        generationStartedAt: staleHeartbeat,
      },
    });
    periodIds.push(period.id);

    const refreshedAt = await weeklyChallengeGenerationInternals.refreshGenerationLease(period.id, generationRunId);
    expect(refreshedAt.getTime()).toBeGreaterThan(staleHeartbeat.getTime());
    expect((await db.weeklyChallengePeriod.findUniqueOrThrow({ where: { id: period.id } })).generationStartedAt)
      .toEqual(refreshedAt);
    await expect(weeklyChallengeGenerationInternals.refreshGenerationLease(period.id, "wrong-run"))
      .rejects.toThrow("租约已失效");
  });

  it("cancels a ready period that missed its activation window", async () => {
    const user = await db.user.create({
      data: {
        kuaishouId: `weekly-missed-activation-${suffix}`,
        nickname: "错过激活测试成员",
        passwordHash: "test",
        role: "MEMBER",
        active: true,
      },
    });
    userIds.push(user.id);
    const period = await db.weeklyChallengePeriod.create({
      data: {
        periodStart: new Date("2025-01-05T16:00:00.000Z"),
        periodEnd: new Date("2025-01-12T16:00:00.000Z"),
        claimEndsAt: new Date("2025-01-15T16:00:00.000Z"),
        status: "READY",
        model: "mock",
        audienceSnapshot: [user.id],
        audienceCount: 1,
        assignments: {
          create: {
            userId: user.id,
            type: "VIDEO_COUNT",
            baselineVideoCount: 0,
            baselineLikes: 0,
            weeklyVideoCounts: [0, 0, 0, 0],
            weeklyLikeSums: [0, 0, 0, 0],
            targetVideoCount: 2,
            rewardPoints: 100,
            difficultyScore: 200,
            title: "错过激活任务",
            description: "该任务不应在周期结束后发布",
            aiReason: "生命周期集成测试",
          },
        },
      },
    });
    periodIds.push(period.id);

    const lifecycle = await activateAndCloseWeeklyChallenges(new Date("2025-01-16T00:00:00.000Z"));

    expect(lifecycle.cancelled).toBe(1);
    expect(lifecycle.cancelledAssignments).toBe(1);
    expect(await db.weeklyChallengePeriod.findUniqueOrThrow({ where: { id: period.id } })).toMatchObject({
      status: "CANCELLED",
      failureReason: "周期结束前未激活，任务未发布",
    });
    expect(await db.weeklyChallengeAssignment.findFirstOrThrow({ where: { periodId: period.id } })).toMatchObject({
      status: "EXPIRED",
    });
    expect(await db.auditLog.findFirst({
      where: {
        action: "WEEKLY_CHALLENGE_PERIOD_CANCELLED",
        entity: "WeeklyChallengePeriod",
        entityId: period.id,
      },
    })).not.toBeNull();
  });

  for (const [mode, periodStart] of providerFailureCases) {
    it(`fails atomically after three ${mode} provider responses`, async () => {
      responseMode = mode;
      await expect(generateWeeklyChallengePeriod({ periodStart })).rejects.toThrow();
      const period = await db.weeklyChallengePeriod.findUniqueOrThrow({ where: { periodStart } });
      periodIds.push(period.id);
      expect(period.status).toBe("FAILED");
      expect(await db.weeklyChallengeAssignment.count({ where: { periodId: period.id } })).toBe(0);
      expect(await db.weeklyChallengeGenerationAttempt.count({
        where: { periodId: period.id, status: "FAILED" },
      })).toBe(3);
    }, 30_000);
  }

  it("awards one race winner, claims once, then reverses and reassigns after video revocation", async () => {
    const week = shanghaiWeekBounds();
    const members = await Promise.all([0, 1].map((index) => db.user.create({
      data: {
        kuaishouId: `weekly-race-${suffix}-${index}`,
        nickname: `竞速成员${index}`,
        passwordHash: "test",
        role: "MEMBER",
        active: true,
        account: { create: { balance: 0 } },
      },
    })));
    userIds.push(...members.map((member) => member.id));
    await db.systemSetting.upsert({
      where: { key: "WEEKLY_CHALLENGES" },
      create: { key: "WEEKLY_CHALLENGES", enabled: true },
      update: { enabled: true },
    });
    const period = await db.weeklyChallengePeriod.create({
      data: {
        periodStart: week.start,
        periodEnd: week.end,
        claimEndsAt: week.claimEndsAt,
        status: "ACTIVE",
        model: "mock",
        audienceSnapshot: members.map((member) => member.id),
        audienceCount: members.length,
        assignments: {
          create: members.map((member) => ({
            userId: member.id,
            type: "VIDEO_COUNT",
            baselineVideoCount: 0,
            baselineLikes: 0,
            weeklyVideoCounts: [0, 0, 0, 0],
            weeklyLikeSums: [0, 0, 0, 0],
            targetVideoCount: 1,
            rewardPoints: 100,
            difficultyScore: 100,
            title: "完成一条通过视频",
            description: "本周完成一条审核通过视频",
            aiReason: "依据匿名基线生成",
          })),
        },
      },
      include: { assignments: true },
    });
    periodIds.push(period.id);
    const videos = await Promise.all(members.map((member, index) => db.videoSubmission.create({
      data: {
        userId: member.id,
        sourceUrl: `https://v.kuaishou.com/weekly-race-${suffix}-${index}`,
        requestUrl: `https://v.kuaishou.com/weekly-race-${suffix}-${index}`,
        sourceKind: "short-link",
        status: "PROCESSING",
        submittedNickname: member.nickname,
        submittedAt: new Date(week.start.getTime() + 60_000 + index),
        idempotencyKey: `weekly-race-video-${suffix}-${index}`,
      },
    })));

    await Promise.all(videos.map((video, index) => creditVideoReward({
      videoId: video.id,
      userId: members[index].id,
      points: 1,
    })));
    const initialWinner = await db.weeklyRaceWinner.findUniqueOrThrow({ where: { periodId: period.id } });
    expect(await db.weeklyRaceWinner.count({ where: { periodId: period.id, reversedAt: null } })).toBe(1);
    expect(await db.pointLedger.count({ where: { type: "WEEKLY_RACE_REWARD", referenceId: initialWinner.id } })).toBe(1);

    const winningAssignment = await db.weeklyChallengeAssignment.findUniqueOrThrow({
      where: { id: initialWinner.assignmentId },
    });
    await db.systemSetting.update({ where: { key: "WEEKLY_CHALLENGES" }, data: { enabled: false } });
    await expect(claimWeeklyChallenge({
      assignmentId: winningAssignment.id,
      userId: winningAssignment.userId,
      idempotencyKey: `weekly-claim-paused-${suffix}`,
    })).rejects.toThrow("发放当前暂停");
    await db.systemSetting.update({ where: { key: "WEEKLY_CHALLENGES" }, data: { enabled: true } });
    const claimResults = await Promise.allSettled([
      claimWeeklyChallenge({
        assignmentId: winningAssignment.id,
        userId: winningAssignment.userId,
        idempotencyKey: `weekly-claim-${suffix}-1`,
      }),
      claimWeeklyChallenge({
        assignmentId: winningAssignment.id,
        userId: winningAssignment.userId,
        idempotencyKey: `weekly-claim-${suffix}-2`,
      }),
    ]);
    expect(claimResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.pointLedger.count({
      where: { type: "WEEKLY_CHALLENGE_REWARD", referenceId: winningAssignment.id },
    })).toBe(1);
    const claimedAssignment = await db.weeklyChallengeAssignment.findUniqueOrThrow({
      where: { id: winningAssignment.id },
    });
    expect(claimedAssignment.claimIdempotencyKey).toMatch(/^weekly-claim-/);
    const otherAssignment = period.assignments.find((assignment) => assignment.id !== winningAssignment.id)!;
    await expect(claimWeeklyChallenge({
      assignmentId: otherAssignment.id,
      userId: otherAssignment.userId,
      idempotencyKey: claimedAssignment.claimIdempotencyKey!,
    })).rejects.toThrow("已用于其他周挑战");

    const winnerVideo = videos[members.findIndex((member) => member.id === initialWinner.userId)];
    await revokeVideoReward({
      videoId: winnerVideo.id,
      actorId: members.find((member) => member.id !== initialWinner.userId)!.id,
      reason: "周挑战撤销集成测试",
    });
    const reassigned = await db.weeklyRaceWinner.findUniqueOrThrow({ where: { periodId: period.id } });
    expect(reassigned.userId).not.toBe(initialWinner.userId);
    expect(reassigned.reversedAt).toBeNull();
    expect(await db.pointLedger.count({
      where: { type: "WEEKLY_CHALLENGE_REVERSAL", referenceId: winningAssignment.id },
    })).toBe(1);
    expect(await db.pointLedger.count({
      where: { type: "WEEKLY_RACE_REVERSAL", referenceId: initialWinner.id },
    })).toBe(1);
    expect(await db.pointLedger.count({
      where: { type: "WEEKLY_RACE_REWARD", referenceId: initialWinner.id },
    })).toBe(2);
  }, 30_000);
});

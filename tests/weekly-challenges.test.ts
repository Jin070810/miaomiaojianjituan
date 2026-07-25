import { describe, expect, it } from "vitest";
import {
  nextShanghaiWeekBounds,
  opaqueMemberRef,
  shanghaiWeekBounds,
} from "@/lib/weekly-challenges";
import { weeklyChallengeGenerationInternals } from "@/lib/weekly-challenge-generation";

const memberRef = "0123456789abcdefabcd";

function profile(overrides: Record<string, unknown> = {}) {
  return {
    userId: "internal-user-id",
    memberRef,
    tenureDays: 120,
    weeklyVideoCounts: [3, 4, 5, 4],
    weeklyLikeSums: [800, 1200, 1600, 1000],
    baselineVideoCount: 4,
    baselineLikes: 1100,
    bestVideoCount: 5,
    bestLikes: 1600,
    previousChallengeCompletionRate: 75,
    newMember: false,
    ...overrides,
  };
}

describe("AI 周挑战核心规则", () => {
  it("uses Monday boundaries and an exclusive Thursday claim deadline in Asia/Shanghai", () => {
    const bounds = shanghaiWeekBounds(new Date("2026-07-25T04:00:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-07-19T16:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-07-26T16:00:00.000Z");
    expect(bounds.claimEndsAt.toISOString()).toBe("2026-07-29T16:00:00.000Z");

    const next = nextShanghaiWeekBounds(new Date("2026-07-25T04:00:00.000Z"));
    expect(next.start.toISOString()).toBe("2026-07-26T16:00:00.000Z");
    expect(next.end.toISOString()).toBe("2026-08-02T16:00:00.000Z");
  });

  it("sets the hard generation deadline to Sunday 23:00 Shanghai time", () => {
    const deadline = weeklyChallengeGenerationInternals.generationDeadline(
      new Date("2026-07-26T16:00:00.000Z"),
    );
    expect(deadline.toISOString()).toBe("2026-07-26T15:00:00.000Z");
  });

  it("enforces the default lower bound and breakthrough caps", () => {
    const bounds = weeklyChallengeGenerationInternals.targetBounds(profile({
      baselineVideoCount: 4,
      bestVideoCount: 6,
      baselineLikes: 1000,
      bestLikes: 1400,
    }));
    expect(bounds.minimumVideos).toBe(5);
    expect(bounds.maximumVideos).toBe(8);
    expect(bounds.minimumLikes).toBe(1200);
    expect(bounds.maximumLikes).toBe(1750);
  });

  it("requires new-member tasks to include at least two approved videos", () => {
    const newMember = profile({
      tenureDays: 3,
      baselineVideoCount: 0,
      baselineLikes: 0,
      bestVideoCount: 0,
      bestLikes: 0,
      newMember: true,
    });
    expect(weeklyChallengeGenerationInternals.targetBounds(newMember).minimumVideos).toBe(2);
    expect(() => weeklyChallengeGenerationInternals.validateGeneratedTask({
      memberRef,
      type: "LIKE_SUM",
      title: "新人点赞挑战",
      description: "在本周完成新人点赞目标",
      reason: "使用匿名新人阶段基线生成",
      targetVideoCount: null,
      targetLikes: 400,
      rewardPoints: 100,
    }, newMember)).toThrow("至少 2 条通过视频");
  });

  it("uses the median from the same newcomer stage without exposing identities", () => {
    const sameStage = [
      profile({ userId: "new-1", memberRef: "00000000000000000001", tenureDays: 3, baselineVideoCount: 0, baselineLikes: 0, newMember: true }),
      profile({ userId: "new-2", memberRef: "00000000000000000002", tenureDays: 5, baselineVideoCount: 2, baselineLikes: 600, newMember: true }),
      profile({ userId: "new-3", memberRef: "00000000000000000003", tenureDays: 6, baselineVideoCount: 4, baselineLikes: 1000, newMember: true }),
      profile({ userId: "new-4", memberRef: "00000000000000000004", tenureDays: 10, baselineVideoCount: 8, baselineLikes: 3000, newMember: true }),
    ];
    const result = weeklyChallengeGenerationInternals.applyNewMemberCohortBaselines(sameStage);
    expect(result.find((item) => item.userId === "new-1")).toMatchObject({
      baselineVideoCount: 2,
      baselineLikes: 600,
    });
    expect(result.find((item) => item.userId === "new-4")).toMatchObject({
      baselineVideoCount: 8,
      baselineLikes: 3000,
    });
  });

  it("rejects unknown targets and scales 300 integer rewards into the weekly pool", () => {
    const baseProfile = profile();
    expect(() => weeklyChallengeGenerationInternals.validateGeneratedTask({
      memberRef,
      type: "VIDEO_COUNT",
      title: "越界数量挑战",
      description: "该任务故意超过服务端允许边界",
      reason: "用于验证恶意模型输出会被拒绝",
      targetVideoCount: 999,
      targetLikes: null,
      rewardPoints: 100,
    }, baseProfile)).toThrow("越界");

    const tasks = Array.from({ length: 300 }, (_, index) => ({
      memberRef: index.toString(16).padStart(20, "0"),
      userId: `user-${index}`,
      type: "VIDEO_COUNT" as const,
      title: "稳定输出挑战",
      description: "完成本周通过视频数量目标",
      reason: "按匿名四周基线生成",
      targetVideoCount: 5,
      targetLikes: null,
      rewardPoints: 1500,
      difficultyScore: 125 + index % 20,
    }));
    const normalized = weeklyChallengeGenerationInternals.normalizeRewards(tasks);
    expect(normalized).toHaveLength(300);
    expect(normalized.reduce((sum, task) => sum + task.rewardPoints, 0)).toBeLessThanOrEqual(10_000);
    expect(normalized.every((task) =>
      Number.isInteger(task.rewardPoints) && task.rewardPoints >= 10 && task.rewardPoints <= 1500)).toBe(true);
    expect(normalized[299].rewardPoints).toBeGreaterThanOrEqual(normalized[0].rewardPoints);
  });

  it("rejects a weekly budget below the guaranteed per-member minimum", () => {
    const tasks = Array.from({ length: 3 }, (_, index) => ({
      memberRef: index.toString(16).padStart(20, "0"),
      userId: `user-${index}`,
      type: "VIDEO_COUNT" as const,
      title: "稳定输出挑战",
      description: "完成本周通过视频数量目标",
      reason: "按匿名四周基线生成",
      targetVideoCount: 5,
      targetLikes: null,
      rewardPoints: 100,
      difficultyScore: 120,
    }));
    expect(() => weeklyChallengeGenerationInternals.normalizeRewards(tasks, 29))
      .toThrow("个人奖励下限");
  });

  it("only sends opaque member references and anonymous aggregates to the model", () => {
    const internalUserId = "sensitive-internal-user-id";
    const opaque = opaqueMemberRef(new Date("2026-07-26T16:00:00.000Z"), internalUserId);
    const prompt = weeklyChallengeGenerationInternals.buildPrompt([profile({
      userId: internalUserId,
      memberRef: opaque,
    })]);
    expect(prompt).toContain(opaque);
    expect(prompt).not.toContain(internalUserId);
    expect(prompt).not.toMatch(/nickname|kuaishou|phone|address|balance|videoUrl/i);
  });
});

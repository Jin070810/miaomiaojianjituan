import { describe, expect, it } from "vitest";
import { nextShanghaiWeekBounds, opaqueMemberRef, shanghaiWeekBounds } from "@/lib/weekly-challenges";
import { weeklyChallengeGenerationInternals } from "@/lib/weekly-challenge-generation";

const memberRef = "0123456789abcdefabcd";

function profile(overrides: Record<string, unknown> = {}) {
  return {
    userId: "internal-user-id",
    memberRef,
    tenureDays: 120,
    weeklyVideoCounts: [0, 0, 3, 4],
    weeklyLikeSums: [0, 0, 800, 1000],
    referenceWeeks: [
      { relativeWeek: "two-weeks-ago" as const, videoCount: 3, likesTotal: 800, likesAverage: 267, likesMax: 400, likesMin: 100 },
      { relativeWeek: "previous-week" as const, videoCount: 4, likesTotal: 1000, likesAverage: 250, likesMax: 400, likesMin: 100 },
    ],
    baselineVideoCount: 4,
    baselineLikes: 1100,
    bestVideoCount: 5,
    bestLikes: 1600,
    previousChallengeCompletionRate: 75,
    newMember: false,
    ...overrides,
  };
}

function combinedTask(overrides: Record<string, unknown> = {}) {
  return {
    memberRef,
    type: "COMBINED" as const,
    baselineVideoCount: 4,
    baselineLikes: 1100,
    title: "综合提升挑战",
    description: "同时完成视频发布和累计点赞目标",
    reason: "依据最近两周逐周数据判断",
    targetVideoCount: 9,
    targetLikes: 2200,
    rewardPoints: 1000,
    ...overrides,
  };
}

describe("AI 周挑战核心规则", () => {
  it("uses Monday boundaries and an exclusive Thursday claim deadline in Asia/Shanghai", () => {
    const bounds = shanghaiWeekBounds(new Date("2026-07-25T04:00:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-07-19T16:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-07-26T16:00:00.000Z");
    expect(bounds.claimEndsAt.toISOString()).toBe("2026-07-29T16:00:00.000Z");
    expect(nextShanghaiWeekBounds(new Date("2026-07-25T04:00:00.000Z")).start.toISOString())
      .toBe("2026-07-26T16:00:00.000Z");
  });

  it("uses hard target floors for three cumulative difficulty tiers", () => {
    const task = weeklyChallengeGenerationInternals.validateGeneratedTask(
      combinedTask({ targetVideoCount: 5, targetLikes: 1400 }),
      profile(),
    );
    expect(task.type).toBe("COMBINED");
    expect(task.rewardTiers.map((tier) => tier.targetVideoCount)).toEqual([7, 8, 9]);
    expect(task.rewardTiers.map((tier) => tier.targetLikes)).toEqual([1720, 1920, 2120]);
    expect(task.rewardTiers.map((tier) => tier.label)).toEqual(["够一够", "努努力", "很难但可试"]);
    expect(task.rewardTiers[0].rewardPoints).toBe(100);
    expect(task.rewardTiers[2].rewardPoints).toBeGreaterThan(task.rewardTiers[1].rewardPoints);
    expect(task.rewardTiers[2].rewardPoints).toBeLessThanOrEqual(1000);
  });

  it("rejects single-metric tasks and a model baseline above the observed peak", () => {
    expect(() => weeklyChallengeGenerationInternals.validateGeneratedTask(
      combinedTask({ baselineVideoCount: 6 }),
      profile(),
    )).toThrow("基线判断超过历史峰值");
    expect(() => weeklyChallengeGenerationInternals.parseModelOutput(JSON.stringify({
      tasks: [{ ...combinedTask(), type: "VIDEO_COUNT" }],
    }))).toThrow();
  });

  it("gives the model two weekly metric snapshots instead of a server median", () => {
    const opaque = opaqueMemberRef(new Date("2026-07-26T16:00:00.000Z"), "sensitive-internal-user-id");
    const payload = JSON.parse(weeklyChallengeGenerationInternals.buildPrompt([profile({
      userId: "sensitive-internal-user-id",
      memberRef: opaque,
    })]));
    expect(payload.members[0].referenceWeeks).toHaveLength(2);
    expect(payload.members[0].referenceWeeks.map((week: { relativeWeek: string }) => week.relativeWeek))
      .toEqual(["two-weeks-ago", "previous-week"]);
    expect(payload.members[0]).not.toHaveProperty("baselineVideoCount");
    expect(payload.members[0]).not.toHaveProperty("baselineLikes");
    expect(payload.members[0]).not.toHaveProperty("tenureDays");
    expect(payload.members[0]).not.toHaveProperty("previousChallengeCompletionRate");
    expect(payload.members[0]).not.toHaveProperty("newMember");
    expect(Object.keys(payload.members[0]).sort()).toEqual(["memberRef", "referenceWeeks"]);
    expect(payload.policies.baselineRules).toContain("最近两周");
    expect(payload.policies.targetRules.COMBINED).toContain("只完成单项");
    expect(payload.policies.output).toContain("baselineVideoCount");
    expect(payload.policies.output).toContain("baselineLikes");
  });

  it("keeps opaque references and accepts streamed JSON", async () => {
    const task = combinedTask();
    const content = JSON.stringify({ tasks: [task] });
    const streamResponse = new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(0, 30) } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(30) } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 8 } })}\n\n`,
      "data: [DONE]\n\n",
    ].join(""), { headers: { "content-type": "text/event-stream" } });
    const streamed = await weeklyChallengeGenerationInternals.readDeepSeekCompletion(streamResponse);
    expect(streamed.content).toBe(content);
    expect(streamed.streamEvents).toBe(3);
    expect(weeklyChallengeGenerationInternals.parseModelOutput(streamed.content).tasks[0].type).toBe("COMBINED");
  });
});

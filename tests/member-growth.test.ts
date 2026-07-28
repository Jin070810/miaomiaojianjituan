import { describe, expect, it } from "vitest";
import {
  buildGrowthTrend,
  growthDelta,
  growthWindows,
  summarizeApprovedVideos,
} from "@/lib/member-growth";
import { chooseGrowthAction } from "@/lib/member-growth-guidance";

describe("member growth metrics", () => {
  it("uses Monday 00:00 in Asia/Shanghai and compares the same elapsed window", () => {
    const windows = growthWindows(new Date("2026-07-28T10:00:00.000Z"));
    expect(windows.currentWeek.start.toISOString()).toBe("2026-07-26T16:00:00.000Z");
    expect(windows.currentWeek.end.toISOString()).toBe("2026-07-28T10:00:00.000Z");
    expect(windows.previousWeekSameWindow.start.toISOString()).toBe("2026-07-19T16:00:00.000Z");
    expect(windows.previousWeekSameWindow.end.toISOString()).toBe("2026-07-21T10:00:00.000Z");
  });

  it("starts a new month at Shanghai midnight", () => {
    const reference = new Date("2026-07-31T16:00:00.000Z");
    const windows = growthWindows(reference);
    expect(windows.month.start.toISOString()).toBe(reference.toISOString());
    expect(windows.month.end.toISOString()).toBe(reference.toISOString());
  });

  it("counts only rows inside the half-open period and keeps integer averages", () => {
    const start = new Date("2026-07-26T16:00:00.000Z");
    const end = new Date("2026-08-02T16:00:00.000Z");
    const metric = summarizeApprovedVideos([
      { submittedAt: new Date("2026-07-26T15:59:59.999Z"), likes: 999, points: 999 },
      { submittedAt: start, likes: 201, points: 50 },
      { submittedAt: new Date("2026-07-28T00:00:00.000Z"), likes: null, points: 0 },
      { submittedAt: end, likes: 500, points: 250 },
    ], start, end);
    expect(metric).toMatchObject({ approvedVideos: 2, likes: 201, videoPoints: 50, averageLikes: 100 });
    expect(Number.isInteger(metric.averageLikes)).toBe(true);
  });

  it("returns zero values for an empty period and integer absolute deltas", () => {
    const start = new Date("2026-07-26T16:00:00.000Z");
    const end = new Date("2026-07-28T10:00:00.000Z");
    const empty = summarizeApprovedVideos([], start, end);
    expect(empty).toMatchObject({ approvedVideos: 0, likes: 0, videoPoints: 0, averageLikes: 0 });
    expect(growthDelta(
      { ...empty, approvedVideos: 3, likes: 1500, videoPoints: 700 },
      { ...empty, approvedVideos: 1, likes: 600, videoPoints: 300 },
    )).toEqual({ approvedVideos: 2, likes: 900, videoPoints: 400 });
  });

  it("builds eight buckets and marks only the current bucket incomplete", () => {
    const reference = new Date("2026-07-28T10:00:00.000Z");
    const currentStart = growthWindows(reference).currentWeek.start;
    const trend = buildGrowthTrend([], currentStart, reference);
    expect(trend).toHaveLength(8);
    expect(trend.slice(0, 7).every((row) => row.complete)).toBe(true);
    expect(trend[7].complete).toBe(false);
  });
});

describe("member growth guidance", () => {
  const base = {
    exceptionCount: 0,
    approvedVideosThisWeek: 2,
    challenge: {
      status: "ACTIVE",
      claimable: false,
      claimableRewardPoints: 0,
      rewardsEnabled: true,
      qualified: false,
    },
  };

  it("uses the fixed claim, exception, challenge, submit and growth priority", () => {
    expect(chooseGrowthAction({
      ...base,
      exceptionCount: 2,
      challenge: { ...base.challenge, claimable: true, claimableRewardPoints: 300 },
    }).kind).toBe("claim");
    expect(chooseGrowthAction({ ...base, exceptionCount: 2 }).kind).toBe("exceptions");
    expect(chooseGrowthAction(base).kind).toBe("challenge");
    expect(chooseGrowthAction({
      ...base,
      approvedVideosThisWeek: 0,
      challenge: { ...base.challenge, status: "CLAIMED", qualified: true },
    }).kind).toBe("submit");
    expect(chooseGrowthAction({
      ...base,
      challenge: { ...base.challenge, status: "CLAIMED", qualified: true },
    }).kind).toBe("growth");
  });
});

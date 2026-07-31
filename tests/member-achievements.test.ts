import { describe, expect, it } from "vitest";
import { calculateGoalEngagement, calculateGrowthExperience, calculateMonthlyGoalTargets, countConsecutiveActiveMonths } from "@/lib/member-achievements";

const at = (value: string) => new Date(value);

describe("成员成长与成就规则", () => {
  it("uses the fixed integer experience formula", () => {
    expect(calculateGrowthExperience({ id: "v1", submittedAt: at("2026-07-01T00:00:00.000Z"), likes: 299, views: 2_999, commentCount: 3 })).toBe(119);
    expect(calculateGrowthExperience({ id: "v2", submittedAt: at("2026-07-01T00:00:00.000Z"), likes: null, views: null, commentCount: null })).toBe(100);
  });

  it("locks a 110% eight-week goal and keeps new-member minimums", () => {
    const monthStart = at("2026-08-01T00:00:00.000Z");
    expect(calculateMonthlyGoalTargets([], monthStart)).toEqual({ baselineVideos: 0, baselineEngagement: 0, targetVideos: 1, targetEngagement: 100 });
    const videos = Array.from({ length: 4 }, (_, index) => ({ id: String(index), submittedAt: at(`2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`), likes: 100, views: 1_000, commentCount: 1 }));
    expect(calculateMonthlyGoalTargets(videos, monthStart)).toMatchObject({ baselineVideos: 2, baselineEngagement: 240, targetVideos: 3, targetEngagement: 264 });
    expect(calculateGoalEngagement(videos[0])).toBe(120);
  });

  it("counts continuous Shanghai months without treating gaps as activity", () => {
    const videos = [
      { id: "1", submittedAt: at("2026-01-31T15:30:00.000Z"), likes: 0, views: 0, commentCount: 0 },
      { id: "2", submittedAt: at("2026-02-15T00:00:00.000Z"), likes: 0, views: 0, commentCount: 0 },
      { id: "3", submittedAt: at("2026-03-15T00:00:00.000Z"), likes: 0, views: 0, commentCount: 0 },
      { id: "4", submittedAt: at("2026-05-15T00:00:00.000Z"), likes: 0, views: 0, commentCount: 0 },
    ];
    expect(countConsecutiveActiveMonths(videos)).toBe(3);
  });
});

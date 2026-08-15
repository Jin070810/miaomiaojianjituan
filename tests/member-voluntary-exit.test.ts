import { describe, expect, it } from "vitest";
import { VOLUNTARY_EXIT_REASONS, memberVoluntaryExitInternals } from "@/lib/member-voluntary-exit";

describe("主动退团原因", () => {
  it("只允许产品定义的四个原因", () => {
    expect(VOLUNTARY_EXIT_REASONS).toEqual([
      "对剪辑团目前的待遇不满意",
      "因学业等原因没有时间继续剪辑",
      "不喜欢妙妙了",
      "其他原因",
    ]);
    expect(memberVoluntaryExitInternals.isVoluntaryExitReason("其他原因")).toBe(true);
    expect(memberVoluntaryExitInternals.isVoluntaryExitReason("随便说说")).toBe(false);
  });
});

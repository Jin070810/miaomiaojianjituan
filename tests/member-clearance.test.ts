import { describe, expect, it } from "vitest";
import { clearanceSchedule, CLEARANCE_DEFAULTS, validateClearancePolicy } from "@/lib/member-clearance";

describe("member clearance policy", () => {
  it("uses the fixed 30/7/3/15 schedule without timezone-dependent rounding", () => {
    const schedule = clearanceSchedule(new Date("2026-07-01T16:00:00.000Z"), { ...CLEARANCE_DEFAULTS, warningDays: [...CLEARANCE_DEFAULTS.warningDays] });
    expect(schedule.deadlineAt.toISOString()).toBe("2026-07-31T16:00:00.000Z");
    expect(schedule.warnings.map((item) => [item.daysRemaining, item.at.toISOString()])).toEqual([
      [7, "2026-07-24T16:00:00.000Z"],
      [3, "2026-07-28T16:00:00.000Z"],
    ]);
    expect(schedule.cooldownEndsAt.toISOString()).toBe("2026-08-15T16:00:00.000Z");
  });

  it("requires two distinct warning points before clearance", () => {
    expect(validateClearancePolicy({ inactivityDays: 30, warningDays: [7, 3], cooldownDays: 15 })).toMatchObject({ warningDays: [7, 3] });
    expect(() => validateClearancePolicy({ inactivityDays: 30, warningDays: [7, 7], cooldownDays: 15 })).toThrow("两个");
    expect(() => validateClearancePolicy({ inactivityDays: 30, warningDays: [30, 3], cooldownDays: 15 })).toThrow("预警");
  });
});

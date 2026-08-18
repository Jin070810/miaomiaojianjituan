import { describe, expect, it, vi } from "vitest";
import { clearanceSchedule, CLEARANCE_DEFAULTS, memberClearanceInternals, validateClearancePolicy } from "@/lib/member-clearance";

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

  it("creates the default policy idempotently when concurrent readers see an empty table", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "policy-1", version: 1 });
    const tx = { membershipClearancePolicyVersion: { findFirst: vi.fn().mockResolvedValue(null), upsert } };
    await memberClearanceInternals.activePolicy(tx as never);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { version: 1 }, update: {} }));
  });

  it("scans every cursor page and isolates a single member failure", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({ id: `eligibility-${String(index + 1).padStart(3, "0")}` }));
    const visited: string[] = [];
    const result = await memberClearanceInternals.runCursorMaintenance({
      fetchPage: async (cursor) => {
        const start = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0;
        return rows.slice(start, start + 200);
      },
      processRow: async (row) => {
        visited.push(row.id);
        if (row.id === "eligibility-250") throw new Error("isolated failure");
        return { warned: 0, cleared: 1 };
      },
    });

    expect(visited).toHaveLength(501);
    expect(result).toMatchObject({ scanned: 501, cleared: 500, warned: 0 });
    expect(result.failures).toEqual([{ eligibilityId: "eligibility-250", error: "isolated failure" }]);
  });
});

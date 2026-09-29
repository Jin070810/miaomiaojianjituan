import { beforeEach, describe, expect, it, vi } from "vitest";

const { recoverMock, sessionMock, weeklyMock, clearanceMock, growthMock, birthdayMock, alertMock } = vi.hoisted(() => ({
  recoverMock: vi.fn(),
  sessionMock: vi.fn(),
  weeklyMock: vi.fn(),
  clearanceMock: vi.fn(),
  growthMock: vi.fn(),
  birthdayMock: vi.fn(),
  alertMock: vi.fn(),
}));

vi.mock("../lib/video-jobs", () => ({ recoverStaleVideoSubmissions: recoverMock }));
vi.mock("../lib/db", () => ({ db: { session: { deleteMany: sessionMock } } }));
vi.mock("../lib/weekly-challenge-generation", () => ({ runWeeklyChallengeMaintenance: weeklyMock }));
vi.mock("../lib/member-clearance", () => ({ runMemberClearanceMaintenance: clearanceMock }));
vi.mock("../lib/member-achievements", () => ({ runMemberGrowthMonthlyMaintenance: growthMock }));
vi.mock("../lib/birthdays", () => ({ runBirthdayMaintenance: birthdayMock }));
vi.mock("../lib/alerts", () => ({ sendOperationalAlert: alertMock }));

import { runWorkerMaintenanceCycle } from "../lib/worker-maintenance";

describe("runWorkerMaintenanceCycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recoverMock.mockResolvedValue({ found: 0, enqueued: 0 });
    sessionMock.mockResolvedValue({ count: 0 });
    weeklyMock.mockResolvedValue({ generationDue: false, periodStart: null });
    clearanceMock.mockResolvedValue({ initialized: false, scanned: 0, warned: 0, cleared: 0, failed: 0, failures: [] });
    growthMock.mockResolvedValue({ reviewed: 0 });
    birthdayMock.mockResolvedValue({});
    alertMock.mockResolvedValue({ sent: true, channels: ["webhook"] });
  });

  it("runs every subsystem and reports no failures when all succeed", async () => {
    const cycle = await runWorkerMaintenanceCycle();
    expect(cycle.failures).toEqual([]);
    expect(cycle.recovery).toEqual({ found: 0, enqueued: 0 });
    expect(cycle.challengeMaintenance).toEqual({ generationDue: false, periodStart: null });
    expect(recoverMock).toHaveBeenCalledTimes(1);
    expect(birthdayMock).toHaveBeenCalledTimes(1);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("keeps other subsystems running and alerts with the failing task's own source", async () => {
    birthdayMock.mockRejectedValue(new Error("生日维护失败"));
    weeklyMock.mockRejectedValue(new Error("周挑战维护失败"));
    const cycle = await runWorkerMaintenanceCycle();
    // 生日/周挑战失败不能吞掉恢复与清退任务的结果。
    expect(cycle.recovery).toEqual({ found: 0, enqueued: 0 });
    expect(cycle.challengeMaintenance).toBeNull();
    expect(cycle.clearanceMaintenance).toEqual({ initialized: false, scanned: 0, warned: 0, cleared: 0, failed: 0, failures: [] });
    expect(cycle.failures.map((failure) => failure.name).sort()).toEqual(["birthday", "weekly-challenge"]);
    const sources = alertMock.mock.calls.map((call) => call[0].source);
    expect(sources).toContain("birthday");
    expect(sources).toContain("weekly-challenge-worker");
    expect(sources).not.toContain("video-worker-maintenance");
    const birthdayAlert = alertMock.mock.calls.find((call) => call[0].source === "birthday");
    expect(birthdayAlert?.[0].message).toContain("birthday");
    expect(birthdayAlert?.[0].details.error).toBe("生日维护失败");
  });
});

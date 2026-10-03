import { afterAll, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({
  heartbeat: vi.fn(), close: vi.fn(), maintenance: vi.fn(), handlers: new Map<string, Function>(),
}));
vi.mock("bullmq", () => ({ DelayedError: class extends Error {}, Worker: class {
  on() { return this; } waitUntilReady() { return Promise.resolve(); } close() { return s.close(); }
} }));
vi.mock("../lib/video-jobs", () => ({ processVideoSubmission: vi.fn(), closeDouyinBrowser: vi.fn(), closeVideoQueue: vi.fn(), connection: vi.fn() }));
vi.mock("../lib/db", () => ({ db: { $disconnect: vi.fn() } }));
vi.mock("../lib/worker-health", () => ({ writeWorkerHeartbeat: s.heartbeat, closeWorkerHealth: vi.fn() }));
vi.mock("../lib/alerts", () => ({ sendOperationalAlert: vi.fn() }));
vi.mock("../lib/worker-maintenance", () => ({ runWorkerMaintenanceCycle: s.maintenance }));
vi.mock("../lib/weekly-challenge-generation", () => ({ generateWeeklyChallengePeriod: vi.fn(), runWeeklyChallengeMaintenance: vi.fn() }));
vi.mock("../lib/weekly-challenge-jobs", () => ({
  closeWeeklyChallengeQueue: vi.fn(), enqueueWeeklyChallengeGeneration: vi.fn(), ensureWeeklyChallengeScheduler: vi.fn(),
}));
vi.mock("../lib/member-clearance-operations", () => ({ getMemberClearanceOperationalSnapshot: vi.fn(), memberClearanceOperationalIssues: vi.fn() }));
vi.useFakeTimers();
const once = vi.spyOn(process, "once").mockImplementation((event, handler) => { s.handlers.set(String(event), handler); return process; });
const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
afterAll(() => { once.mockRestore(); exit.mockRestore(); vi.clearAllTimers(); vi.useRealTimers(); });

it("keeps heartbeats alive during slow startup maintenance and a graceful drain", async () => {
  let finishMaintenance!: (value: { failures: [] }) => void;
  let finishDrain!: () => void;
  s.maintenance.mockReturnValue(new Promise((resolve) => { finishMaintenance = resolve; }));
  s.close.mockReturnValue(new Promise<void>((resolve) => { finishDrain = resolve; }));
  await import("../worker");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(s.heartbeat.mock.calls.length).toBeGreaterThanOrEqual(4);
  const beforeDrain = s.heartbeat.mock.calls.length;
  s.handlers.get("SIGTERM")!();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(s.heartbeat.mock.calls.length).toBeGreaterThan(beforeDrain + 2);
  expect(exit).not.toHaveBeenCalled();
  finishDrain();
  await vi.advanceTimersByTimeAsync(0);
  expect(exit).not.toHaveBeenCalled();
  finishMaintenance({ failures: [] });
  await vi.advanceTimersByTimeAsync(0);
  expect(exit).toHaveBeenCalledWith(0);
});

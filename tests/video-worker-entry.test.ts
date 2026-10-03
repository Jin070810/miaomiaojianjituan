import { afterAll, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ processors: new Map<string, Function>(), processVideo: vi.fn() }));
vi.mock("bullmq", () => ({
  Worker: class {
    constructor(name: string, processor: Function) { state.processors.set(name, processor); }
    on() { return this; }
    waitUntilReady() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  },
  DelayedError: class extends Error {},
}));
vi.mock("../lib/video-jobs", () => ({
  processVideoSubmission: state.processVideo, closeDouyinBrowser: vi.fn(), closeVideoQueue: vi.fn(), connection: vi.fn(),
}));
vi.mock("../lib/db", () => ({ db: { $disconnect: vi.fn() } }));
vi.mock("../lib/worker-health", () => ({ writeWorkerHeartbeat: vi.fn(), closeWorkerHealth: vi.fn() }));
vi.mock("../lib/alerts", () => ({ sendOperationalAlert: vi.fn() }));
vi.mock("../lib/worker-maintenance", () => ({ runWorkerMaintenanceCycle: vi.fn().mockResolvedValue({ failures: [] }) }));
vi.mock("../lib/weekly-challenge-generation", () => ({
  generateWeeklyChallengePeriod: vi.fn(), runWeeklyChallengeMaintenance: vi.fn(),
}));
vi.mock("../lib/weekly-challenge-jobs", () => ({
  closeWeeklyChallengeQueue: vi.fn(), enqueueWeeklyChallengeGeneration: vi.fn(), ensureWeeklyChallengeScheduler: vi.fn(),
}));
vi.mock("../lib/member-clearance-operations", () => ({
  getMemberClearanceOperationalSnapshot: vi.fn(), memberClearanceOperationalIssues: vi.fn(),
}));

vi.useFakeTimers();
const once = vi.spyOn(process, "once").mockImplementation(() => process);
afterAll(() => { once.mockRestore(); vi.clearAllTimers(); vi.useRealTimers(); });

it("passes the actual BullMQ final attempt to the video processor", async () => {
  await import("../worker");
  const processor = state.processors.get("kuaishou-video")!;
  for (let attemptsMade = 0; attemptsMade < 3; attemptsMade++) {
    await processor({ data: { videoId: "test-video" }, attemptsMade, opts: { attempts: 3 } }, "lock");
  }
  expect(state.processVideo.mock.calls).toEqual([
    ["test-video", { finalAttempt: false }],
    ["test-video", { finalAttempt: false }],
    ["test-video", { finalAttempt: true }],
  ]);
});

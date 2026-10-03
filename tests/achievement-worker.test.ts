import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ batch: vi.fn(), status: vi.fn(), alert: vi.fn() }));
vi.mock("@/lib/member-achievement-jobs", () => ({ runMemberAchievementRefreshBatch: mocks.batch, getAchievementRefreshStatus: mocks.status }));
vi.mock("@/lib/alerts", () => ({ sendOperationalAlert: mocks.alert }));
import { startMemberAchievementRefreshWorker } from "@/lib/member-achievement-worker";

describe("achievement background lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.batch.mockReset().mockResolvedValue({ processed: 0, failed: 0, stale: 0 });
    mocks.status.mockReset().mockResolvedValue({ pending: 0, delayed: 0, oldestRequestedAt: null });
    mocks.alert.mockReset().mockResolvedValue({ sent: true });
  });
  afterEach(() => { vi.useRealTimers(); });

  it("never overlaps batches and drains before shutdown", async () => {
    let release!: () => void;
    mocks.batch.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ processed: 1, failed: 0, stale: 0 }); }));
    const stop = startMemberAchievementRefreshWorker();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    let drained = false;
    const stopping = stop().then(() => { drained = true; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(drained).toBe(false);
    release();
    await stopping;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });

  it("alerts on failed work and a prolonged backlog without exposing records", async () => {
    mocks.batch.mockResolvedValue({ processed: 0, failed: 2, stale: 0 });
    mocks.status.mockResolvedValue({ pending: 4, delayed: 2, oldestRequestedAt: new Date(Date.now() - 6 * 60_000) });
    const stop = startMemberAchievementRefreshWorker();
    await vi.advanceTimersByTimeAsync(0);
    await stop();
    expect(mocks.alert).toHaveBeenCalledWith(expect.objectContaining({ source: "member-achievements", details: { failed: 2 } }));
    expect(mocks.alert).toHaveBeenCalledWith(expect.objectContaining({ source: "member-achievements", details: { pending: 4, delayed: 2 } }));
  });

  it("recovers on the next poll after a database failure", async () => {
    mocks.batch.mockRejectedValueOnce(new Error("synthetic connection secret"));
    const stop = startMemberAchievementRefreshWorker();
    await vi.advanceTimersByTimeAsync(5_000);
    await stop();
    expect(mocks.batch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mocks.alert.mock.calls)).not.toContain("synthetic connection secret");
  });
});

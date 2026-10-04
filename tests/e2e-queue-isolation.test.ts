import type { Queue } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { assertIsolatedE2EServices, pauseFixtureQueue } from "./support/pause-fixture-queue";

describe("E2E background queue isolation", () => {
  it("requires explicit isolated loopback services before touching Redis", () => {
    const env = { PLAYWRIGHT_ISOLATED_SERVICES: "1", DATABASE_URL: "postgresql://test@localhost/isolated?schema=e2e", REDIS_URL: "redis://127.0.0.1:6379/14" };
    expect(() => assertIsolatedE2EServices(env)).not.toThrow();
    for (const override of [
      { PLAYWRIGHT_ISOLATED_SERVICES: "0" },
      { DATABASE_URL: "postgresql://test@localhost/isolated" },
      { DATABASE_URL: "postgresql://test@production.invalid/app?schema=public" },
      { REDIS_URL: "redis://production.invalid" },
    ]) expect(() => assertIsolatedE2EServices({ ...env, ...override })).toThrow("E2E 队列隔离");
  });

  it("waits for active jobs before exposing fixtures and restores its own pause", async () => {
    const queue = { isPaused: vi.fn().mockResolvedValue(false), pause: vi.fn(), resume: vi.fn(), getActiveCount: vi.fn().mockResolvedValueOnce(1).mockResolvedValue(0) };
    const restore = await pauseFixtureQueue(queue as unknown as Queue);
    expect(queue.pause).toHaveBeenCalledOnce();
    expect(queue.getActiveCount).toHaveBeenCalledTimes(2);
    expect(queue.resume).not.toHaveBeenCalled();
    await restore();
    expect(queue.resume).toHaveBeenCalledOnce();
  });

  it.each([false, true])("fails bounded drain and preserves the original paused=%s state", async (paused) => {
    const queue = { isPaused: vi.fn().mockResolvedValue(paused), pause: vi.fn(), resume: vi.fn(), getActiveCount: vi.fn().mockResolvedValue(1) };
    await expect(pauseFixtureQueue(queue as unknown as Queue, 0)).rejects.toThrow("时限内排空");
    expect(queue.pause).toHaveBeenCalledTimes(paused ? 0 : 1);
    expect(queue.resume).toHaveBeenCalledTimes(paused ? 0 : 1);
  });
});

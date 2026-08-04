import { afterEach, describe, expect, it } from "vitest";
import { checkRateLimitStore, closeRateLimitStore } from "../lib/rate-limit";
import { closeVideoQueue, getVideoQueueMetrics } from "../lib/video-jobs";
import { checkWorkerHeartbeat, closeWorkerHealthConnection } from "../lib/worker-health";
import {
  closeWeeklyChallengeQueue,
  enqueueWeeklyChallengeGeneration,
  ensureWeeklyChallengeScheduler,
  getWeeklyChallengeQueueStatus,
} from "../lib/weekly-challenge-jobs";

async function closeOperationalConnections() {
  await Promise.all([
    closeVideoQueue(),
    closeRateLimitStore(),
    closeWorkerHealthConnection(),
    closeWeeklyChallengeQueue(),
  ]);
}

describe.runIf(Boolean(process.env.REDIS_URL))("operational Redis connections", () => {
  afterEach(closeOperationalConnections);

  it("can close all clients and reconnect cleanly", async () => {
    const connect = async () => Promise.all([
      getVideoQueueMetrics(),
      checkRateLimitStore(),
      checkWorkerHeartbeat(),
    ]);

    const first = await connect();
    expect(first[0]).toMatchObject({
      waiting: expect.any(Number),
      active: expect.any(Number),
      failed: expect.any(Number),
    });
    expect(first[1]).toBe("ok");

    await closeOperationalConnections();

    const second = await connect();
    expect(second[0]).toMatchObject({
      waiting: expect.any(Number),
      active: expect.any(Number),
      failed: expect.any(Number),
    });
    expect(second[1]).toBe("ok");
  });

  it("keeps a durable Shanghai scheduler and deduplicates manual generation jobs", async () => {
    await ensureWeeklyChallengeScheduler();
    const status = await getWeeklyChallengeQueueStatus();
    expect(status).toMatchObject({
      schedulerConfigured: true,
      nextScheduledAt: expect.any(Number),
    });

    const periodStart = new Date("2099-01-04T16:00:00.000Z");
    const first = await enqueueWeeklyChallengeGeneration(periodStart, true, true);
    const second = await enqueueWeeklyChallengeGeneration(periodStart, true, true);
    expect(second.job.id).toBe(first.job.id);
    expect(second.reused).toBe(true);
    expect(["waiting", "delayed"]).toContain(second.state);
    await first.job.remove();
  });
});

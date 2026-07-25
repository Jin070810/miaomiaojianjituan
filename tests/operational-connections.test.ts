import { afterEach, describe, expect, it } from "vitest";
import { checkRateLimitStore, closeRateLimitStore } from "../lib/rate-limit";
import { closeVideoQueue, getVideoQueueMetrics } from "../lib/video-jobs";
import { checkWorkerHeartbeat, closeWorkerHealthConnection } from "../lib/worker-health";

async function closeOperationalConnections() {
  await Promise.all([
    closeVideoQueue(),
    closeRateLimitStore(),
    closeWorkerHealthConnection(),
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
});

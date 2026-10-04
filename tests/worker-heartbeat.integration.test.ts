import { hostname } from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Redis from "ioredis";
import { closeWorkerHealth, closeWorkerHealthConnection, getWorkerHeartbeat, writeWorkerHeartbeat } from "../lib/worker-health";

describe.skipIf(process.env.RUN_DB_TESTS !== "1" || !process.env.REDIS_URL)("per-instance Worker heartbeats", () => {
  const key = "miaomiao:worker:heartbeat";
  const index = "miaomiao:worker:instances";
  const ownKey = `${key}:${process.env.HOSTNAME || hostname()}`;
  const foreignKey = `${key}:integration-other-worker`;
  let redis: Redis;
  beforeAll(async () => { redis = new Redis(process.env.REDIS_URL!); await redis.ping(); });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeWorkerHealthConnection();
    await redis.del(key, ownKey, foreignKey);
    await redis.zrem(index, ownKey, foreignKey);
    await redis.quit();
  });
  it("retains heartbeats while draining", async () => {
    await writeWorkerHeartbeat("draining");
    expect(await getWorkerHeartbeat()).toMatchObject({ status: "ok", state: "draining", instanceId: process.env.HOSTNAME || hostname() });
  });
  it("prefers a healthy Worker with the expected release SHA to an older instance", async () => {
    vi.stubEnv("APP_COMMIT_SHA", "new-release-test");
    await writeWorkerHeartbeat("running");
    const older = JSON.stringify({ heartbeatAt: new Date().toISOString(), commit: "old-release-test", ownerToken: "other", state: "running", instanceId: "integration-other-worker" });
    await redis.set(foreignKey, older, "EX", 45);
    await redis.set(key, older, "EX", 45);
    await redis.zadd(index, Date.now() + 45_000, foreignKey);
    expect(await getWorkerHeartbeat()).toMatchObject({ status: "ok", commit: "new-release-test" });
  });
  it("an old owner cannot delete a replacement heartbeat", async () => {
    const replacement = JSON.stringify({ heartbeatAt: new Date().toISOString(), commit: "new-release-test", ownerToken: "replacement", state: "running", instanceId: process.env.HOSTNAME || hostname() });
    await redis.set(ownKey, replacement, "EX", 45);
    await redis.set(key, replacement, "EX", 45);
    await closeWorkerHealth();
    expect(await redis.get(ownKey)).toBe(replacement);
    expect(await redis.get(key)).toBe(replacement);
    expect(await redis.zscore(index, ownKey)).not.toBeNull();
  });
});

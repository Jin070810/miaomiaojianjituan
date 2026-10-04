import { setTimeout as delay } from "node:timers/promises";
import type { Queue } from "bullmq";

// Test harness only: keep the real Worker alive while protecting deliberate
// FAILED UI fixtures from its scheduled retry of the same unique period.
export async function pauseFixtureQueue(queue: Queue, timeoutMs = 15_000) {
  const alreadyPaused = await queue.isPaused();
  if (!alreadyPaused) await queue.pause();
  const restore = async () => { if (!alreadyPaused) await queue.resume(); };
  try {
    const deadline = Date.now() + timeoutMs;
    while (await queue.getActiveCount()) {
      if (Date.now() >= deadline) throw new Error("E2E 周挑战队列未在时限内排空");
      await delay(50);
    }
    return restore;
  } catch (error) {
    await restore();
    throw error;
  }
}

export function assertIsolatedE2EServices(env: Record<string, string | undefined>) {
  const database = new URL(env.DATABASE_URL ?? "postgresql://invalid");
  const redis = new URL(env.REDIS_URL ?? "redis://invalid");
  const local = (host: string) => ["127.0.0.1", "localhost", "[::1]"].includes(host);
  if (env.PLAYWRIGHT_ISOLATED_SERVICES !== "1"
    || !["postgres:", "postgresql:"].includes(database.protocol)
    || !database.searchParams.get("schema")
    || !local(database.hostname) || !local(redis.hostname)
    || !["redis:", "rediss:"].includes(redis.protocol)) {
    throw new Error("E2E 队列隔离仅允许显式测试数据库 schema、本机独立 Redis 和 PLAYWRIGHT_ISOLATED_SERVICES=1");
  }
}

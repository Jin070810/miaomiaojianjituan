import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Queue, QueueEvents, Worker } from "bullmq";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { connection } from "@/lib/video-jobs";
import { generateWeeklyChallengePeriod } from "@/lib/weekly-challenge-generation";
import { pauseFixtureQueue } from "./support/pause-fixture-queue";

describe.skipIf(process.env.RUN_DB_TESTS !== "1" || !process.env.REDIS_URL)("weekly E2E fixture versus real generation", () => {
  it("reproduces the model change and unique collision, then protects fixtures until teardown", async () => {
    const name = `e2e-weekly-isolation-${crypto.randomUUID()}`;
    const queue = new Queue(name, { connection: connection() });
    const events = new QueueEvents(name, { connection: connection() });
    const worker = new Worker(name, async (job) => {
      await generateWeeklyChallengePeriod({ periodStart: new Date(job.data.periodStart), retryFailed: true });
    }, { connection: connection() });
    const start = new Date(Date.UTC(2040, 0, 1) + Math.floor(Math.random() * 10_000) * 7 * 86_400_000);
    const data = {
      periodStart: start, periodEnd: new Date(start.getTime() + 7 * 86_400_000),
      claimEndsAt: new Date(start.getTime() + 10 * 86_400_000),
      status: "FAILED" as const, model: "e2e-mock-model", promptVersion: "isolation-test", audienceSnapshot: [], audienceCount: 0,
    };
    let periodId: string | undefined;
    let restore: (() => Promise<void>) | undefined;
    try {
      await Promise.all([events.waitUntilReady(), worker.waitUntilReady()]);
      const period = await db.weeklyChallengePeriod.create({ data });
      periodId = period.id;
      const first = await queue.add("retry", { periodStart: start.toISOString() });
      await first.waitUntilFinished(events, 5_000);
      expect(await db.weeklyChallengePeriod.findUniqueOrThrow({ where: { id: period.id } })).toMatchObject({ status: "READY" });
      // The old model-based fixture cleanup misses this now-regenerated row.
      expect(await db.weeklyChallengePeriod.count({ where: { id: period.id, model: "e2e-mock-model" } })).toBe(0);
      await expect(db.weeklyChallengePeriod.create({ data })).rejects.toMatchObject({ code: "P2002" });

      restore = await pauseFixtureQueue(queue);
      await db.weeklyChallengePeriod.update({ where: { id: period.id }, data: { status: "FAILED", model: "e2e-mock-model" } });
      const second = await queue.add("retry", { periodStart: start.toISOString() });
      await delay(150);
      expect(await queue.getActiveCount()).toBe(0);
      expect(await second.isCompleted()).toBe(false);
      expect(await db.weeklyChallengePeriod.findUniqueOrThrow({ where: { id: period.id } })).toMatchObject({ status: "FAILED", model: "e2e-mock-model" });
      await restore();
      restore = undefined;
      await second.waitUntilFinished(events, 5_000);
      expect(await db.weeklyChallengePeriod.findUniqueOrThrow({ where: { id: period.id } })).toMatchObject({ status: "READY" });
      expect(await queue.isPaused()).toBe(false);
    } finally {
      await worker.close();
      await restore?.();
      await queue.obliterate();
      await Promise.all([queue.close(), events.close()]);
      if (periodId) {
        await db.auditLog.deleteMany({ where: { entity: "WeeklyChallengePeriod", entityId: periodId } });
        await db.weeklyChallengePeriod.delete({ where: { id: periodId } });
      }
    }
  }, 20_000);
});

import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { Queue } from "bullmq";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../lib/db";
import { getDatabasePressure } from "../lib/database-performance";
import { closePerformanceStore, getPerformanceSnapshot, recordPerformance } from "../lib/performance-store";
import { QUEUE_SNAPSHOT_LUA, parseQueueSnapshot } from "../lib/performance-queue";
import { requestContext } from "../lib/request-context";
import { creditVideoReward } from "../lib/points";
const enabled = process.env.RUN_DB_TESTS === "1";
describe.skipIf(!enabled)("real Redis and PostgreSQL performance probes", () => {
  afterAll(async () => { closePerformanceStore(); await db.$disconnect(); });
  it("writes and reads real hourly histogram data", async () => {
    expect(await recordPerformance("home_get", 123)).toBe(true);
    const snapshot = await getPerformanceSnapshot();
    expect(snapshot.status).toBe("ok");
    expect(snapshot.rows.find((row) => row.key === "home_get")?.count).toBeGreaterThan(0);
  });
  it("preserves the job trace in the financial audit transaction", async () => {
    const suffix = randomUUID();
    const trace = randomUUID();
    const user = await db.user.create({ data: { kuaishouId: "performance-" + suffix, nickname: "合成观测测试", passwordHash: "unused", account: { create: { balance: 0 } } } });
    const video = await db.videoSubmission.create({ data: { userId: user.id, sourceUrl: "https://www.kuaishou.com/short-video/test", requestUrl: "https://www.kuaishou.com/short-video/test", sourceKind: "long-link", submittedNickname: user.nickname, photoId: "perf-" + suffix, likes: 300, status: "PROCESSING", idempotencyKey: "perf-" + suffix } }).catch(async (error) => { await db.user.delete({ where: { id: user.id } }); throw error; });
    try {
      await requestContext.run({ id: trace }, () => creditVideoReward({ videoId: video.id, userId: user.id, points: 50 }));
      expect(await db.auditLog.count({ where: { action: "VIDEO_APPROVED", entityId: video.id, requestId: trace } })).toBe(1);
      expect((await db.pointAccount.findUniqueOrThrow({ where: { userId: user.id } })).balance).toBe(50);
    } finally {
      const review = await db.videoSecondaryReview.findUnique({ where: { videoId: video.id } });
      if (review) await db.auditLog.deleteMany({ where: { entityId: review.id } });
      await db.auditLog.deleteMany({ where: { entityId: video.id } });
      await db.user.delete({ where: { id: user.id } });
    }
  });
  it("reads actual BullMQ FIFO age and pause state without changing jobs", async () => {
    const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
    const name = "performance-test-" + randomUUID();
    const queue = new Queue(name, { connection: redis });
    const jobs = [];
    try {
      jobs.push(await queue.add("first", { private: "never-return" }, { timestamp: Date.now() - 2000 }));
      jobs.push(await queue.add("second", {}, { timestamp: Date.now() - 1000 }));
      jobs.push(await queue.add("delayed", {}, { delay: 60000 }));
      const result = parseQueueSnapshot(await redis.eval(QUEUE_SNAPSHOT_LUA, 1, "bull:" + name + ":"));
      expect(result).toMatchObject({ waiting: 2, active: 0, delayed: 1, paused: 0, prioritized: 0 });
      expect(result!.headAgeMs).toBeGreaterThanOrEqual(2000);
      expect(JSON.stringify(result)).not.toContain("never-return");
      await queue.pause();
      expect(parseQueueSnapshot(await redis.eval(QUEUE_SNAPSHOT_LUA, 1, "bull:" + name + ":"))).toMatchObject({ waiting: 0, paused: 2, headAgeMs: null });
    } finally {
      for (const job of jobs) await job.remove();
      await queue.close();
      await redis.del(...["meta", "id", "events", "marker", "paused", "wait", "active", "delayed", "prioritized"].map((suffix) => "bull:" + name + ":" + suffix));
      redis.disconnect();
    }
  });
  it("observes a real lock waiter without exposing its query", async () => {
    const lock = Math.floor(Math.random() * 2000000000);
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const acquired = new Promise<void>((resolve) => { started = resolve; });
    const owner = db.$transaction(async (tx) => { await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${lock}::bigint)`; started(); await held; }, { timeout: 10000 });
    await acquired;
    const waiter = db.$transaction(async (tx) => { await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${lock}::bigint)`; }, { timeout: 10000 });
    try {
      await expect.poll(async () => (await getDatabasePressure())?.lockWaiting, { timeout: 5000 }).toBeGreaterThan(0);
      const pressure = await getDatabasePressure();
      expect(pressure?.oldestTransactionSeconds).toBeGreaterThan(0);
      expect(Object.keys(pressure!).sort()).toEqual(["active", "at", "lockWaiting", "longTransactions", "oldestTransactionSeconds"]);
    } finally { release(); await Promise.all([owner, waiter]); }
  });
});

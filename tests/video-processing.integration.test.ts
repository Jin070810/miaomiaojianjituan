import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Queue, Worker } from "bullmq";
import { db } from "../lib/db";
import { VideoFetchError } from "../lib/fetch-errors";
import {
  assertVideoProcessingLease, claimVideoProcessingAttempt, releaseVideoProcessingAttempt,
  VIDEO_PROCESSING_BUDGET_MS, VideoProcessingLeaseLostError,
} from "../lib/video-processing";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/kuaishou-fetch", () => ({ fetchKuaishouVideo: fetchMock }));
vi.mock("../lib/douyin-fetch", () => ({ fetchDouyinVideo: fetchMock, closeDouyinBrowser: vi.fn() }));
import { closeVideoQueue, connection, enqueueVideo, prepareVideoReprocess, processVideoSubmission, recoverStaleVideoSubmissions } from "../lib/video-jobs";

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("durable video processing", () => {
  let userId: string;
  const videoIds: string[] = [];
  let queue: Queue;
  beforeAll(async () => {
    const user = await db.user.create({ data: {
      kuaishouId: `processing-test-${randomUUID()}`, nickname: "重试测试", passwordHash: "test",
      account: { create: { balance: 0 } },
    } });
    userId = user.id;
    if (process.env.REDIS_URL) queue = new Queue("kuaishou-video", { connection: connection() });
  });
  beforeEach(() => { fetchMock.mockReset(); });
  afterAll(async () => {
    if (queue) {
      for (const id of videoIds) await (await queue.getJob(`video-${id}`))?.remove();
      await queue.close();
    }
    await closeVideoQueue();
    const accounts = await db.pointAccount.findMany({ where: { userId }, select: { id: true } });
    await db.pointLedger.deleteMany({ where: { accountId: { in: accounts.map((a) => a.id) } } });
    await db.auditLog.deleteMany({ where: { entityId: { in: videoIds } } });
    await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  });
  async function video(submittedAt = new Date(Date.now() - 120_000)) {
    const row = await db.videoSubmission.create({ data: {
      userId, sourceUrl: "https://www.kuaishou.com/short-video/processing-test", requestUrl: "https://www.kuaishou.com/short-video/processing-test",
      sourceKind: "long-link", submittedNickname: "重试测试", idempotencyKey: randomUUID(),
      submittedAt,
    } });
    videoIds.push(row.id);
    return row;
  }
  async function readyAgain(id: string) {
    await db.videoProcessingState.update({ where: { videoId: id }, data: { nextAttemptAt: new Date(0) } });
  }

  it("keeps a three-attempt budget even when each caller thinks it is the first queue attempt", async () => {
    const row = await video();
    fetchMock.mockRejectedValue(new VideoFetchError("temporary timeout", "transient"));
    for (let i = 0; i < 2; i++) {
      await expect(processVideoSubmission(row.id, { finalAttempt: false })).rejects.toThrow("temporary timeout");
      await readyAgain(row.id);
    }
    await expect(processVideoSubmission(row.id, { finalAttempt: false })).resolves.toMatchObject({ status: "REJECTED" });
    await processVideoSubmission(row.id, { finalAttempt: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await db.videoProcessingState.findUnique({ where: { videoId: row.id } })).toMatchObject({ attempts: 3, leaseToken: null });
    expect(await db.auditLog.count({ where: { entityId: row.id, action: "VIDEO_AUTO_REJECTED" } })).toBe(1);
  });

  it("leases a submission once under concurrent deliveries", async () => {
    const row = await video();
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimVideoProcessingAttempt(row.id)));
    expect(claims.filter((c) => c.kind === "claimed")).toHaveLength(1);
    expect(claims.filter((c) => c.kind === "deferred")).toHaveLength(7);
    expect(await db.videoProcessingState.findUnique({ where: { videoId: row.id } })).toMatchObject({ attempts: 1 });
  });

  it("an expired lease can be recovered, and its old owner cannot write or clear the new lease", async () => {
    const row = await video();
    const first = await claimVideoProcessingAttempt(row.id);
    if (first.kind !== "claimed") throw new Error("expected first lease");
    await db.videoProcessingState.update({ where: { videoId: row.id }, data: { leaseExpiresAt: new Date(0) } });
    const next = await claimVideoProcessingAttempt(row.id);
    if (next.kind !== "claimed") throw new Error("expected replacement lease");
    await expect(db.$transaction((tx) => assertVideoProcessingLease(tx, row.id, first.attempt.leaseToken!)))
      .rejects.toBeInstanceOf(VideoProcessingLeaseLostError);
    await releaseVideoProcessingAttempt(row.id, first.attempt.leaseToken!, "transient-fetch");
    expect(await db.videoProcessingState.findUnique({ where: { videoId: row.id } }))
      .toMatchObject({ attempts: 2, leaseToken: next.attempt.leaseToken });
  });

  it("stops expired processing campaigns without starting another external fetch", async () => {
    const row = await video();
    await db.videoProcessingState.create({ data: {
      videoId: row.id, startedAt: new Date(Date.now() - VIDEO_PROCESSING_BUDGET_MS - 1), attempts: 1,
    } });
    await expect(processVideoSubmission(row.id)).resolves.toMatchObject({ status: "REJECTED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("permanent failures end immediately and explicit reprocess resets the budget once", async () => {
    const row = await video();
    fetchMock.mockRejectedValue(new VideoFetchError("video removed", "permanent"));
    await expect(processVideoSubmission(row.id)).resolves.toMatchObject({ status: "REJECTED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await Promise.all(Array.from({ length: 3 }, () => prepareVideoReprocess({ videoId: row.id, actorId: userId })));
    expect(await db.videoProcessingState.findUnique({ where: { videoId: row.id } })).toMatchObject({ attempts: 0, leaseToken: null });
    expect(await db.auditLog.count({ where: { entityId: row.id, action: "VIDEO_REPROCESS_REQUESTED" } })).toBe(1);
  });

  it("commits fetched metadata, approval and the point ledger together", async () => {
    const row = await video();
    const photoId = `processing-photo-${randomUUID()}`;
    fetchMock.mockResolvedValue({
      source: { requestUrl: row.requestUrl, sourceUrl: row.sourceUrl, sourceKind: row.sourceKind, shortCode: null },
      photoId, likes: 500, views: 1000, commentCount: 2, caption: "test", coverUrl: null,
      publishedAt: row.submittedAt, owner: row.submittedNickname, ownerMatches: true, ownerMatchMethod: "exact", points: 50,
    });
    const result = await processVideoSubmission(row.id);
    expect(result).toMatchObject({ status: "APPROVED", photoId, points: 50 });
    await processVideoSubmission(row.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await db.pointLedger.count({ where: { referenceId: row.id, type: "VIDEO_REWARD" } })).toBe(1);
  });

  it.skipIf(!process.env.REDIS_URL)("finishes a real BullMQ retry sequence and does not resurrect it during recovery", async () => {
    const row = await video();
    fetchMock.mockRejectedValue(new VideoFetchError("temporary timeout", "transient"));
    const worker = new Worker("kuaishou-video", async (job) => {
      if (job.data.videoId !== row.id) return;
      return processVideoSubmission(job.data.videoId, { finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1) });
    }, { connection: connection(), concurrency: 1 });
    worker.on("error", () => undefined);
    try {
      await worker.waitUntilReady();
      await enqueueVideo(row.id);
      await expect.poll(async () => (await db.videoSubmission.findUnique({ where: { id: row.id } }))?.status,
        { timeout: 15_000, interval: 100 }).toBe("REJECTED");
      await recoverStaleVideoSubmissions();
      expect(await enqueueVideo(row.id)).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      await worker.close();
    }
  }, 20_000);

  it.skipIf(!process.env.REDIS_URL)("reconciles an exhausted legacy job instead of deleting it and replenishing attempts", async () => {
    const row = await video();
    const worker = new Worker("kuaishou-video", async (job) => {
      if (job.data.videoId === row.id) throw new Error("simulated infrastructure failure before processing");
    }, { connection: connection(), concurrency: 1 });
    worker.on("error", () => undefined);
    try {
      await worker.waitUntilReady();
      const job = await queue.add("fetch", { videoId: row.id }, { jobId: `video-${row.id}`, attempts: 1 });
      await expect.poll(() => job.getState(), { timeout: 5_000, interval: 50 }).toBe("failed");
    } finally {
      await worker.close();
    }
    expect(await enqueueVideo(row.id)).toBe(false);
    expect(await db.videoSubmission.findUnique({ where: { id: row.id } })).toMatchObject({ status: "REJECTED" });
    expect(await (await queue.getJob(`video-${row.id}`))?.getState()).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  }, 10_000);

  it.skipIf(!process.env.REDIS_URL)("advances past already queued old submissions to recover a newer missing job", async () => {
    const rows = await Promise.all([0, 1, 2].map((i) => video(new Date(Date.UTC(2000, 0, 1, 0, i)))));
    await enqueueVideo(rows[0].id);
    await enqueueVideo(rows[1].id);
    expect(await queue.getJob(`video-${rows[2].id}`)).toBeUndefined();
    await recoverStaleVideoSubmissions(2);
    await recoverStaleVideoSubmissions(2);
    expect(await queue.getJob(`video-${rows[2].id}`)).toBeDefined();
  });
});

import { Queue } from "bullmq";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { fetchKuaishouVideo } from "./kuaishou-fetch";
import { fetchDouyinVideo, closeDouyinBrowser } from "./douyin-fetch";
import { isDouyinSourceKind } from "./douyin";
import { videoEligibilityError } from "./kuaishou";
import { creditVideoReward } from "./points";
import { calculateSnapshotVideoPoints, captureVideoPointRule, snapshotRule, videoRuleEvidence } from "./video-point-rule-snapshots";
import { createNotification } from "./notifications";
import { isPermanentFetchError } from "./fetch-errors";
import { PlatformBindingError, requireVerifiedVideoAuthor } from "./platform-bindings";
import {
  assertVideoProcessingLease, claimVideoProcessingAttempt, lockVideoProcessing,
  releaseVideoProcessingAttempt, resetVideoProcessingBudget, VIDEO_MAX_ATTEMPTS,
  VideoProcessingDeferredError, VideoProcessingLeaseLostError, type VideoFailureKind,
} from "./video-processing";

export type VideoFetchFailureAction = "reject-permanent" | "reject-final" | "retry";

// 抓取失败的处理决策：确定性失败直接驳回；瞬时错误在还有队列重试机会时抛回重试，
// 到了最后一次尝试则按“抓取暂时失败”驳回，成员之后仍可重新提交或申诉。
export function resolveFetchFailureAction(error: unknown, finalAttempt: boolean): VideoFetchFailureAction {
  if (isPermanentFetchError(error)) return "reject-permanent";
  if (finalAttempt) return "reject-final";
  return "retry";
}

function connection() {
  const url = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: url.hostname, port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}

let queue: Queue | null = null;

function getQueue() {
  return (queue ??= new Queue("kuaishou-video", { connection: connection() }));
}

async function autoRejectVideoWithTx(
  tx: Prisma.TransactionClient,
  videoId: string,
  reason: string,
  data: Prisma.VideoSubmissionUpdateInput = {},
) {
  const current = await tx.videoSubmission.findUnique({ where: { id: videoId } });
  if (!current) throw new Error("视频记录不存在");
  if (["APPROVED", "REVOKED"].includes(current.status)) return current;
  const claimed = await tx.videoSubmission.updateMany({
    where: { id: videoId, status: { in: ["PROCESSING", "FAILED", "PENDING_REVIEW"] } },
    data: {
      ...data,
      status: "REJECTED",
      points: 0,
      reviewReason: reason,
      processedAt: new Date(),
      reviewedAt: new Date(),
    },
  });
  if (claimed.count !== 1) return tx.videoSubmission.findUniqueOrThrow({ where: { id: videoId } });
  const updated = await tx.videoSubmission.findUniqueOrThrow({ where: { id: videoId } });
  const pointRuleSnapshot = await tx.videoPointRuleSnapshot.findUnique({ where: { videoId } });
  await tx.auditLog.create({
    data: {
      action: "VIDEO_AUTO_REJECTED",
      entity: "VideoSubmission",
      entityId: videoId,
      beforeValue: {
        status: current.status,
        likes: current.likes,
        photoId: current.photoId,
        matchedOwner: current.matchedOwner,
        authorUid: current.fetchedAuthorUid,
        authorEvidenceVersion: current.authorEvidenceVersion,
      },
      afterValue: {
        status: updated.status,
        likes: updated.likes,
        photoId: updated.photoId,
        matchedOwner: updated.matchedOwner,
        calculation: videoRuleEvidence(pointRuleSnapshot, updated.likes, 0),
        authorUid: updated.fetchedAuthorUid,
        authorEvidenceVersion: updated.authorEvidenceVersion,
      },
      reason,
    },
  });
  await createNotification(tx, {
    userId: current.userId,
    type: "VIDEO_RESULT",
    title: "视频未通过校验",
    body: reason,
    entityType: "VideoSubmission",
    entityId: videoId,
    metadata: { status: "REJECTED" },
    dedupeKey: `video:${videoId}:auto-rejected:${updated.reviewedAt?.toISOString() ?? "final"}`,
  });
  return updated;
}

export async function autoRejectVideo(
  videoId: string,
  reason: string,
  data: Prisma.VideoSubmissionUpdateInput = {},
) {
  return db.$transaction((tx) => autoRejectVideoWithTx(tx, videoId, reason, data));
}

const TRANSIENT_FETCH_REJECT_REASON = "视频抓取暂时失败（已自动重试仍未成功），请稍后重新提交；如确认视频正常可提交申诉";

export async function processVideoSubmission(
  videoId: string,
  options: { finalAttempt?: boolean } = {},
) {
  const claim = await claimVideoProcessingAttempt(videoId);
  if (claim.kind === "terminal") return claim.video;
  if (claim.kind === "deferred") throw new VideoProcessingDeferredError(claim.retryAt);
  if (claim.kind === "exhausted") {
    return finalizeVideoFetchFailure(videoId, undefined, claim.state.lastFailure === "infrastructure" ? "infrastructure" : "transient-fetch");
  }
  const { video, attempt } = claim;
  const token = attempt.leaseToken!;
  const finalAttempt = options.finalAttempt === true || attempt.attempts >= VIDEO_MAX_ATTEMPTS;
  let failure: VideoFailureKind | undefined;
  try {
    const pointRuleSnapshot = await captureVideoPointRule(video.id, "FIRST_AUTOMATIC_REVIEW");
    const pointRule = snapshotRule(pointRuleSnapshot);
    let fetched;
    try {
      fetched = isDouyinSourceKind(video.sourceKind)
        ? await fetchDouyinVideo(video.sourceUrl, video.submittedNickname, pointRule)
        : await fetchKuaishouVideo(video.sourceUrl, video.submittedNickname, pointRule);
    } catch (error) {
      const action = resolveFetchFailureAction(error, finalAttempt);
      failure = action === "reject-permanent" ? "permanent-fetch" : "transient-fetch";
      if (action === "reject-permanent") {
        return await rejectClaimedVideo(video.id, token,
          `链接失效或视频不存在：${error instanceof Error ? error.message : "无法获取视频数据"}`,
          { rawPayload: { fetchFailed: true, failureKind: failure, attempts: attempt.attempts } });
      }
      if (action === "reject-final") return await finalizeVideoFetchFailure(video.id, token, failure);
      throw error;
    }
    const points = calculateSnapshotVideoPoints(fetched.likes, pointRuleSnapshot);
    const fetchedFields: Prisma.VideoSubmissionUpdateInput = {
      requestUrl: fetched.source.requestUrl,
      sourceKind: fetched.source.sourceKind,
      shortCode: fetched.source.shortCode,
      photoId: fetched.photoId,
      likes: fetched.likes,
      views: fetched.views,
      commentCount: fetched.commentCount,
      caption: fetched.caption,
      coverUrl: fetched.coverUrl,
      metadataFetchedAt: new Date(),
      publishedAt: fetched.publishedAt,
      fetchedOwner: fetched.owner,
      fetchedAuthorUid: fetched.authorUid,
      authorEvidenceVersion: fetched.authorUid ? 1 : null,
      matchedOwner: false,
      rawPayload: {
        sourceUrl: fetched.source.sourceUrl,
        nicknameMatchMethod: fetched.ownerMatchMethod,
        authorEvidenceVersion: fetched.authorUid ? 1 : null,
        ...("rawPayload" in fetched ? fetched.rawPayload : {}),
      },
    };
    // The partial unique index is the final guard. The advisory lock also lets
    // competing submissions return a useful duplicate reason without racing.
    // Metadata, status, points and audit are committed together under the lease.
    return await db.$transaction(async (tx) => {
      await lockVideoProcessing(tx, video.id);
      await assertVideoProcessingLease(tx, video.id, token);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`video-photo:${fetched.photoId}`})::bigint)`;
      await tx.$queryRaw`SELECT "id" FROM "VideoSubmission" WHERE "id" = ${video.id} FOR UPDATE`;
      const current = await tx.videoSubmission.findUniqueOrThrow({ where: { id: video.id } });
      if (!["PROCESSING", "FAILED", "PENDING_REVIEW"].includes(current.status)) return current;
      const duplicate = await tx.videoSubmission.findFirst({
        where: { photoId: fetched.photoId, id: { not: video.id }, status: { in: ["APPROVED", "PENDING_REVIEW", "PROCESSING"] } },
      });
      if (duplicate) {
        return autoRejectVideoWithTx(tx, video.id, "该视频已提交过，不能重复兑换", {
          ...fetchedFields,
          rawPayload: { ...fetchedFields.rawPayload as object, duplicatePhotoId: fetched.photoId },
        });
      }
      const eligibilityError = videoEligibilityError(fetched.likes, fetched.publishedAt, video.submittedAt, pointRule);
      if (eligibilityError) return autoRejectVideoWithTx(tx, video.id, eligibilityError, fetchedFields);
      try {
        await requireVerifiedVideoAuthor(tx, { userId: video.userId, sourceKind: fetched.source.sourceKind, fetchedAuthorUid: fetched.authorUid, authorEvidenceVersion: fetched.authorUid ? 1 : null });
        fetchedFields.matchedOwner = true;
        fetchedFields.rawPayload = { ...fetchedFields.rawPayload as object, ownerMatchMethod: "verified-platform-uid" };
      } catch (error) {
        if (!(error instanceof PlatformBindingError)) throw error;
        return autoRejectVideoWithTx(tx, video.id, error.message, fetchedFields);
      }
      await tx.videoSubmission.update({
        where: { id: video.id },
        data: { ...fetchedFields, points, status: "PROCESSING", processedAt: new Date(), reviewedAt: null, reviewReason: null },
      });
      return creditVideoReward({ videoId: video.id, userId: video.userId, points }, tx);
    }, { timeout: 15_000 });
  } catch (error) {
    if (error instanceof VideoProcessingLeaseLostError) throw error;
    failure ??= "infrastructure";
    if (finalAttempt) return await finalizeVideoFetchFailure(video.id, token, failure);
    throw error;
  } finally {
    // A stale Worker must never release a newer Worker's lease.
    await releaseVideoProcessingAttempt(video.id, token, failure);
  }
}

async function rejectClaimedVideo(videoId: string, token: string, reason: string, data: Prisma.VideoSubmissionUpdateInput) {
  return db.$transaction(async (tx) => {
    await lockVideoProcessing(tx, videoId);
    await assertVideoProcessingLease(tx, videoId, token);
    return autoRejectVideoWithTx(tx, videoId, reason, data);
  });
}

export async function prepareVideoReprocess(input: { videoId: string; actorId: string; ip?: string }) {
  return db.$transaction(async (tx) => {
    const video = await tx.videoSubmission.findUnique({ where: { id: input.videoId } });
    if (!video) throw new Error("视频记录不存在");
    if (video.status === "PROCESSING") return video;
    if (!["REJECTED", "FAILED"].includes(video.status)) {
      throw new Error("只有已驳回或抓取失败的视频可以重新抓取");
    }
    if (video.photoId) {
      const duplicate = await tx.videoSubmission.findFirst({
        where: {
          id: { not: video.id },
          photoId: video.photoId,
          status: { in: ["PROCESSING", "PENDING_REVIEW", "APPROVED"] },
        },
        select: { id: true },
      });
      if (duplicate) throw new Error("同一视频已有有效提交记录，不能重新抓取旧记录");
    }
    const claimed = await tx.videoSubmission.updateMany({
      where: { id: video.id, status: { in: ["REJECTED", "FAILED"] } },
      data: {
        status: "PROCESSING",
        points: 0,
        processedAt: null,
        reviewedAt: null,
        reviewReason: null,
        fetchedAuthorUid: null,
        authorEvidenceVersion: null,
        verifiedBindingId: null,
        matchedOwner: null,
      },
    });
    if (claimed.count !== 1) return tx.videoSubmission.findUniqueOrThrow({ where: { id: video.id } });
    await resetVideoProcessingBudget(tx, video.id);
    const updated = await tx.videoSubmission.findUniqueOrThrow({ where: { id: video.id } });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "VIDEO_REPROCESS_REQUESTED",
        entity: "VideoSubmission",
        entityId: video.id,
        beforeValue: { status: video.status, reviewReason: video.reviewReason },
        afterValue: { status: updated.status },
        ip: input.ip,
      },
    });
    return updated;
  });
}

export async function finalizeVideoFetchFailure(videoId: string, token?: string, failure: VideoFailureKind = "transient-fetch") {
  return db.$transaction(async (tx) => {
    await lockVideoProcessing(tx, videoId);
    const state = await tx.videoProcessingState.findUnique({ where: { videoId } });
    if (token) await assertVideoProcessingLease(tx, videoId, token);
    else if (state?.leaseToken && state.leaseExpiresAt && state.leaseExpiresAt > new Date()) {
      throw new VideoProcessingDeferredError(state.leaseExpiresAt);
    }
    return autoRejectVideoWithTx(tx, videoId,
      failure === "infrastructure"
        ? "系统处理暂时失败（已停止自动重试），请稍后重新提交或申诉"
        : TRANSIENT_FETCH_REJECT_REASON,
      { rawPayload: { fetchFailed: failure !== "infrastructure", failureKind: failure, transient: true, attempts: state?.attempts ?? 0 } });
  });
}

export async function enqueueVideo(videoId: string, options: { retryFailed?: boolean } = {}) {
  if (!process.env.REDIS_URL) {
    void runInlineVideoSubmission(videoId).catch(() => undefined);
    return true;
  }
  const video = await db.videoSubmission.findUnique({ where: { id: videoId }, include: { processingState: true } });
  if (!video || video.status !== "PROCESSING") return false;
  const videoQueue = getQueue();
  const jobId = `video-${videoId}`;
  const existing = await videoQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "failed" && !options.retryFailed) {
      // Terminal queue failures are reconciled, never given a fresh retry budget.
      try {
        await finalizeVideoFetchFailure(videoId, undefined, video.processingState?.lastFailure === "transient-fetch" ? "transient-fetch" : "infrastructure");
      } catch (error) {
        if (!(error instanceof VideoProcessingDeferredError)) throw error;
      }
      return false;
    }
    if (state !== "failed" && state !== "completed") return false;
    await existing.remove();
  }
  await videoQueue.add("fetch", { videoId }, {
    jobId,
    attempts: Math.max(1, VIDEO_MAX_ATTEMPTS - (video.processingState?.attempts ?? 0)),
    delay: Math.max(0, (video.processingState?.nextAttemptAt.getTime() ?? 0) - Date.now()),
    backoff: { type: "exponential", delay: 1500 },
    removeOnComplete: true,
    removeOnFail: 100,
  });
  return true;
}

// Local fallback obeys the same durable budget and lease as the Redis Worker.
export async function runInlineVideoSubmission(videoId: string) {
  let attempt = 0;
  while (attempt < VIDEO_MAX_ATTEMPTS) {
    try {
      await processVideoSubmission(videoId, { finalAttempt: attempt === VIDEO_MAX_ATTEMPTS - 1 });
      return;
    } catch (error) {
      if (error instanceof VideoProcessingDeferredError) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(100, error.retryAt.getTime() - Date.now())));
        continue;
      }
      attempt++;
      if (attempt >= VIDEO_MAX_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * 2 ** (attempt - 1)));
    }
  }
}

let recoveryCursor: { submittedAt: Date; id: string } | null = null;

export async function recoverStaleVideoSubmissions(limit = 200) {
  if (!process.env.REDIS_URL) return { found: 0, enqueued: 0 };
  const now = new Date();
  const take = Math.min(500, Math.max(1, limit));
  const after = recoveryCursor;
  const rows = await db.videoSubmission.findMany({
    where: {
      status: "PROCESSING",
      submittedAt: { lt: new Date(now.getTime() - 60_000) },
      AND: [
        { OR: [
          { processingState: { is: null } },
          { processingState: { is: { nextAttemptAt: { lte: now }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] } } },
        ] },
        ...(after ? [{ OR: [{ submittedAt: { gt: after.submittedAt } }, { submittedAt: after.submittedAt, id: { gt: after.id } }] }] : []),
      ],
    },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    take,
    select: { id: true, submittedAt: true },
  });
  recoveryCursor = rows.length === take ? rows[rows.length - 1] : null;
  let enqueued = 0;
  for (const row of rows) {
    if (await enqueueVideo(row.id)) enqueued++;
  }
  return { found: rows.length, enqueued };
}

export async function getVideoQueueMetrics() {
  if (!process.env.REDIS_URL) return null;
  const counts = await getQueue().getJobCounts("waiting", "active", "delayed", "failed", "completed");
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    completed: counts.completed ?? 0,
  };
}

export async function closeVideoQueue() {
  const current = queue;
  queue = null;
  if (!current) return;
  await current.close();
}

export { closeDouyinBrowser };

export { connection };

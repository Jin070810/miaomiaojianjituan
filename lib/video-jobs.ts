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
  return { host: url.hostname, port: Number(url.port || 6379), password: url.password || undefined };
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
      },
      afterValue: {
        status: updated.status,
        likes: updated.likes,
        photoId: updated.photoId,
        matchedOwner: updated.matchedOwner,
        calculation: videoRuleEvidence(pointRuleSnapshot, updated.likes, 0),
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
  const video = await db.videoSubmission.findUnique({ where: { id: videoId }, include: { user: true } });
  if (!video || !["PROCESSING", "FAILED", "PENDING_REVIEW"].includes(video.status)) return video;
  const pointRuleSnapshot = await captureVideoPointRule(video.id, "FIRST_AUTOMATIC_REVIEW");
  const pointRule = snapshotRule(pointRuleSnapshot);
    let fetched;
    try {
      fetched = isDouyinSourceKind(video.sourceKind)
        ? await fetchDouyinVideo(video.sourceUrl, video.submittedNickname, pointRule)
        : await fetchKuaishouVideo(video.sourceUrl, video.submittedNickname, pointRule);
    } catch (error) {
      const action = resolveFetchFailureAction(error, options.finalAttempt === true);
      if (action === "reject-permanent") {
        return autoRejectVideo(
          video.id,
          `链接失效或视频不存在：${error instanceof Error ? error.message : "无法获取视频数据"}`,
          { rawPayload: { fetchFailed: true } },
        );
      }
      if (action === "reject-final") {
        return finalizeVideoFetchFailure(video.id);
      }
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
      matchedOwner: fetched.ownerMatches,
      rawPayload: {
        sourceUrl: fetched.source.sourceUrl,
        ownerMatchMethod: fetched.ownerMatchMethod,
        ...("rawPayload" in fetched ? fetched.rawPayload : {}),
      },
    };
    // 同一 photoId 的判重与占位必须在同一把事务级咨询锁内完成：两条并发提交各自
    // findFirst 后再写入会双双入账（重复发积分）。photoId 没有数据库唯一约束
    // （已驳回记录允许复用），只能靠这把锁串行化同一视频的全部入账路径。
    const outcome = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`video-photo:${fetched.photoId}`})::bigint)`;
      const duplicate = await tx.videoSubmission.findFirst({
        where: { photoId: fetched.photoId, id: { not: video.id }, status: { in: ["APPROVED", "PENDING_REVIEW", "PROCESSING"] } },
      });
      if (duplicate) {
        return { kind: "rejected" as const, result: await autoRejectVideoWithTx(tx, video.id, "该视频已提交过，不能重复兑换", {
          ...fetchedFields,
          rawPayload: { ...fetchedFields.rawPayload as object, duplicatePhotoId: fetched.photoId },
        }) };
      }
      const eligibilityError = videoEligibilityError(fetched.likes, fetched.publishedAt, video.submittedAt, pointRule);
      if (eligibilityError) {
        return { kind: "rejected" as const, result: await autoRejectVideoWithTx(tx, video.id, eligibilityError, fetchedFields) };
      }
      if (!fetched.ownerMatches) {
        return { kind: "rejected" as const, result: await autoRejectVideoWithTx(
          tx,
          video.id,
          `作者不一致：抓取到“${fetched.owner}”，提交昵称为“${video.submittedNickname}”`,
          fetchedFields,
        ) };
      }
      try {
        const updated = await tx.videoSubmission.update({
          where: { id: video.id },
          data: {
            ...fetchedFields,
            points,
            status: "PROCESSING",
            processedAt: new Date(),
            reviewedAt: null,
            reviewReason: null,
          },
        });
        return { kind: "claimed" as const, updated };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return { kind: "rejected" as const, result: await autoRejectVideoWithTx(tx, video.id, "该视频已被其他提交记录结算，不能重复兑换", {
            ...fetchedFields,
            rawPayload: { ...fetchedFields.rawPayload as object, duplicatePhotoId: fetched.photoId },
          }) };
        }
        throw error;
      }
    });
    if (outcome.kind === "rejected") return outcome.result;
    return creditVideoReward({ videoId: video.id, userId: video.userId, points });
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
      },
    });
    if (claimed.count !== 1) return tx.videoSubmission.findUniqueOrThrow({ where: { id: video.id } });
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

export async function finalizeVideoFetchFailure(videoId: string) {
  return autoRejectVideo(videoId, TRANSIENT_FETCH_REJECT_REASON, {
    rawPayload: { fetchFailed: true, transient: true },
  });
}

export async function enqueueVideo(videoId: string) {
  if (process.env.REDIS_URL) {
    const videoQueue = getQueue();
    const jobId = `video-${videoId}`;
    const existing = await videoQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed") await existing.remove();
      else return;
    }
    await videoQueue.add("fetch", { videoId }, {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 1500 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  } else {
    void runInlineVideoSubmission(videoId).catch(() => undefined);
  }
}

// 无 Redis 的回退模式没有队列重试，这里内联补一次重试，
// 仍失败（瞬时错误）则按终局尝试自动驳回，避免视频永远卡在 PROCESSING。
async function runInlineVideoSubmission(videoId: string) {
  try {
    await processVideoSubmission(videoId, { finalAttempt: false });
  } catch (error) {
    if (error instanceof Error && error.name === "VideoFetchError") {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    await processVideoSubmission(videoId, { finalAttempt: true });
  }
}

export async function recoverStaleVideoSubmissions(limit = 200) {
  if (!process.env.REDIS_URL) return { found: 0, enqueued: 0 };
  const rows = await db.videoSubmission.findMany({
    where: {
      status: "PROCESSING",
      submittedAt: { lt: new Date(Date.now() - 60_000) },
    },
    orderBy: { submittedAt: "asc" },
    take: Math.min(500, Math.max(1, limit)),
    select: { id: true },
  });
  let enqueued = 0;
  for (const row of rows) {
    await enqueueVideo(row.id);
    enqueued += 1;
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

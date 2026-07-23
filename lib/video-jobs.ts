import { Queue } from "bullmq";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { fetchKuaishouVideo } from "./kuaishou-fetch";
import { videoEligibilityError } from "./kuaishou";
import { creditVideoReward } from "./points";
import { getVideoPointRule } from "./point-rules";

function connection() {
  const url = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return { host: url.hostname, port: Number(url.port || 6379), password: url.password || undefined };
}

let queue: Queue | null = null;

function getQueue() {
  return (queue ??= new Queue("kuaishou-video", { connection: connection() }));
}

async function autoRejectVideo(
  videoId: string,
  reason: string,
  data: Prisma.VideoSubmissionUpdateInput = {},
) {
  return db.$transaction(async (tx) => {
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
        },
        reason,
      },
    });
    return updated;
  });
}

export async function processVideoSubmission(videoId: string) {
  const video = await db.videoSubmission.findUnique({ where: { id: videoId }, include: { user: true } });
  if (!video || !["PROCESSING", "FAILED", "PENDING_REVIEW"].includes(video.status)) return video;
  const pointRule = await getVideoPointRule();
    let fetched;
    try {
      fetched = await fetchKuaishouVideo(video.sourceUrl, video.submittedNickname, pointRule);
    } catch (error) {
      return autoRejectVideo(
        video.id,
        error instanceof Error ? `链接失效或视频不存在：${error.message}` : "链接失效或视频不存在，无法获取视频数据",
        { rawPayload: { fetchFailed: true } },
      );
    }
    const duplicate = await db.videoSubmission.findFirst({
      where: { photoId: fetched.photoId, id: { not: video.id }, status: { in: ["APPROVED", "PENDING_REVIEW", "PROCESSING"] } },
    });
    const fetchedFields: Prisma.VideoSubmissionUpdateInput = {
      requestUrl: fetched.source.requestUrl,
      sourceKind: fetched.source.sourceKind,
      shortCode: fetched.source.shortCode,
      photoId: fetched.photoId,
      likes: fetched.likes,
      views: fetched.views,
      publishedAt: fetched.publishedAt,
      fetchedOwner: fetched.owner,
      matchedOwner: fetched.ownerMatches,
      rawPayload: {
        sourceUrl: fetched.source.sourceUrl,
        ownerMatchMethod: fetched.ownerMatchMethod,
      },
    };
    if (duplicate) {
      return autoRejectVideo(video.id, "该视频已提交过，不能重复兑换", {
        ...fetchedFields,
        rawPayload: { ...fetchedFields.rawPayload as object, duplicatePhotoId: fetched.photoId },
      });
    }
    const eligibilityError = videoEligibilityError(fetched.likes, fetched.publishedAt, video.submittedAt, pointRule);
    if (eligibilityError) return autoRejectVideo(video.id, eligibilityError, fetchedFields);

    if (!fetched.ownerMatches) {
      return autoRejectVideo(
        video.id,
        `作者不一致：抓取到“${fetched.owner}”，提交昵称为“${video.submittedNickname}”`,
        fetchedFields,
      );
    }

    let updated;
    try {
      updated = await db.videoSubmission.update({
        where: { id: video.id },
        data: {
          ...fetchedFields,
          points: fetched.points,
          status: "PROCESSING",
          processedAt: new Date(),
          reviewedAt: null,
          reviewReason: null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return autoRejectVideo(video.id, "该视频已被其他提交记录结算，不能重复兑换", {
          ...fetchedFields,
          rawPayload: { ...fetchedFields.rawPayload as object, duplicatePhotoId: fetched.photoId },
        });
      }
      throw error;
    }
    if (fetched.ownerMatches) {
      return creditVideoReward({ videoId: video.id, userId: video.userId, points: fetched.points });
    }
  return updated;
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
    void processVideoSubmission(videoId).catch(() => undefined);
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

export { connection };

import { Queue } from "bullmq";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { fetchKuaishouVideo } from "./kuaishou-fetch";
import { videoEligibilityError } from "./kuaishou";
import { creditVideoReward } from "./points";

function connection() {
  const url = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return { host: url.hostname, port: Number(url.port || 6379), password: url.password || undefined };
}

let queue: Queue | null = null;

function getQueue() {
  return (queue ??= new Queue("kuaishou-video", { connection: connection() }));
}

export async function processVideoSubmission(videoId: string) {
  const video = await db.videoSubmission.findUnique({ where: { id: videoId }, include: { user: true } });
  if (!video || !["PROCESSING", "FAILED"].includes(video.status)) return video;
  try {
    const fetched = await fetchKuaishouVideo(video.sourceUrl, video.submittedNickname);
    const duplicate = await db.videoSubmission.findFirst({
      where: { photoId: fetched.photoId, id: { not: video.id }, status: { in: ["APPROVED", "PENDING_REVIEW", "PROCESSING"] } },
    });
    if (duplicate) {
      return db.videoSubmission.update({
        where: { id: video.id },
        data: {
          status: "REJECTED",
          likes: fetched.likes,
          views: fetched.views,
          publishedAt: fetched.publishedAt,
          fetchedOwner: fetched.owner,
          matchedOwner: fetched.ownerMatches,
          reviewReason: "该视频已提交过，不能重复兑换",
          processedAt: new Date(),
          rawPayload: { sourceKind: fetched.source.sourceKind, duplicatePhotoId: fetched.photoId },
        },
      });
    }
    const eligibilityError = videoEligibilityError(fetched.likes, fetched.publishedAt, video.submittedAt);
    if (eligibilityError) {
      return db.videoSubmission.update({
        where: { id: video.id },
        data: {
          status: "REJECTED",
          requestUrl: fetched.source.requestUrl,
          sourceKind: fetched.source.sourceKind,
          shortCode: fetched.source.shortCode,
          photoId: fetched.photoId,
          likes: fetched.likes,
          views: fetched.views,
          publishedAt: fetched.publishedAt,
          fetchedOwner: fetched.owner,
          matchedOwner: fetched.ownerMatches,
          points: 0,
          reviewReason: eligibilityError,
          processedAt: new Date(),
          rawPayload: { sourceKind: fetched.source.sourceKind },
        },
      });
    }
    let updated;
    try {
      updated = await db.videoSubmission.update({
        where: { id: video.id },
        data: {
          requestUrl: fetched.source.requestUrl,
          sourceKind: fetched.source.sourceKind,
          shortCode: fetched.source.shortCode,
          likes: fetched.likes,
          views: fetched.views,
          publishedAt: fetched.publishedAt,
          photoId: fetched.photoId,
          fetchedOwner: fetched.owner,
          matchedOwner: fetched.ownerMatches,
          points: fetched.points,
          rawPayload: { sourceUrl: fetched.source.sourceUrl },
          status: fetched.ownerMatches ? "PROCESSING" : "PENDING_REVIEW",
          processedAt: new Date(),
          reviewReason: fetched.ownerMatches ? null : `作者不一致：抓取到“${fetched.owner}”，提交昵称为“${video.submittedNickname}”`,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return db.videoSubmission.update({
          where: { id: video.id },
          data: {
            status: "REJECTED",
            likes: fetched.likes,
            views: fetched.views,
            publishedAt: fetched.publishedAt,
            fetchedOwner: fetched.owner,
            matchedOwner: fetched.ownerMatches,
            reviewReason: "该视频已被其他提交记录结算，不能重复兑换",
            processedAt: new Date(),
            rawPayload: { sourceKind: fetched.source.sourceKind, duplicatePhotoId: fetched.photoId },
          },
        });
      }
      throw error;
    }
    if (fetched.ownerMatches) {
      return creditVideoReward({ videoId: video.id, userId: video.userId, points: fetched.points });
    }
    return updated;
  } catch (error) {
    await db.videoSubmission.update({
      where: { id: video.id },
      data: { status: "FAILED", processedAt: new Date(), reviewReason: error instanceof Error ? error.message : "抓取失败" },
    });
    throw error;
  }
}

export async function enqueueVideo(videoId: string) {
  if (process.env.REDIS_URL) {
    await getQueue().add("fetch", { videoId }, {
      jobId: `${videoId}-${Date.now()}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 1500 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  } else {
    void processVideoSubmission(videoId).catch(() => undefined);
  }
}

export { connection };

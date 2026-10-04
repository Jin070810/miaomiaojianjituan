import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";

export const VIDEO_MAX_ATTEMPTS = 3;
export const VIDEO_PROCESSING_BUDGET_MS = 10 * 60_000;
export const VIDEO_LEASE_MS = 120_000;
export const VIDEO_PROCESSING_STATUSES = ["PROCESSING", "FAILED", "PENDING_REVIEW"] as const;
export type VideoFailureKind = "transient-fetch" | "permanent-fetch" | "infrastructure";

export class VideoProcessingDeferredError extends Error {
  constructor(readonly retryAt: Date) {
    super("视频已在处理中或正在等待重试");
    this.name = "VideoProcessingDeferredError";
  }
}

export class VideoProcessingLeaseLostError extends Error {
  constructor() {
    super("视频处理租约已失效");
    this.name = "VideoProcessingLeaseLostError";
  }
}

// Lock the parent first in every processing/reprocess path, including before
// touching the child state. Network requests never run inside this transaction.
export async function lockVideoProcessing(tx: Prisma.TransactionClient, videoId: string) {
  await tx.$queryRaw`SELECT id FROM "VideoSubmission" WHERE id = ${videoId} FOR UPDATE`;
}

export async function claimVideoProcessingAttempt(videoId: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    await lockVideoProcessing(tx, videoId);
    const video = await tx.videoSubmission.findUnique({ where: { id: videoId } });
    if (!video || !VIDEO_PROCESSING_STATUSES.includes(video.status as typeof VIDEO_PROCESSING_STATUSES[number])) {
      return { kind: "terminal" as const, video };
    }
    const state = await tx.videoProcessingState.upsert({
      where: { videoId }, create: { videoId, startedAt: now, nextAttemptAt: now }, update: {},
    });
    if (state.leaseToken && state.leaseExpiresAt && state.leaseExpiresAt > now) {
      return { kind: "deferred" as const, retryAt: state.leaseExpiresAt };
    }
    if (state.attempts >= VIDEO_MAX_ATTEMPTS || now.getTime() - state.startedAt.getTime() >= VIDEO_PROCESSING_BUDGET_MS) {
      return { kind: "exhausted" as const, video, state };
    }
    if (state.nextAttemptAt > now) return { kind: "deferred" as const, retryAt: state.nextAttemptAt };
    const attempt = await tx.videoProcessingState.update({
      where: { videoId },
      data: {
        attempts: { increment: 1 }, leaseToken: randomUUID(),
        leaseExpiresAt: new Date(now.getTime() + VIDEO_LEASE_MS),
      },
    });
    return { kind: "claimed" as const, video, attempt };
  });
}

export async function assertVideoProcessingLease(tx: Prisma.TransactionClient, videoId: string, token: string) {
  const state = await tx.videoProcessingState.findUnique({ where: { videoId } });
  if (!state || state.leaseToken !== token) throw new VideoProcessingLeaseLostError();
  return state;
}

export async function releaseVideoProcessingAttempt(videoId: string, token: string, failure?: VideoFailureKind) {
  const state = await db.videoProcessingState.findUnique({ where: { videoId } });
  if (!state || state.leaseToken !== token) return;
  await db.videoProcessingState.updateMany({
    where: { videoId, leaseToken: token },
    data: {
      leaseToken: null, leaseExpiresAt: null,
      nextAttemptAt: new Date(Date.now() + (failure ? 1500 * 2 ** Math.max(0, state.attempts - 1) : 0)),
      ...(failure ? { lastFailure: failure } : {}),
    },
  });
}

export async function resetVideoProcessingBudget(tx: Prisma.TransactionClient, videoId: string) {
  const now = new Date();
  await tx.videoProcessingState.upsert({
    where: { videoId },
    create: { videoId, startedAt: now, nextAttemptAt: now },
    update: { attempts: 0, startedAt: now, nextAttemptAt: now, leaseToken: null, leaseExpiresAt: null, lastFailure: null },
  });
}

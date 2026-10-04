import { createHash } from "node:crypto";
import { Prisma, type VideoPointRuleSnapshot } from "@prisma/client";
import { db } from "./db";
import { asVideoPointRuleConfig, DEFAULT_VIDEO_POINT_RULE, type VideoPointRuleConfig } from "./point-rules";

export const VIDEO_POINT_FORMULA_VERSION = "likes-v1";
export type VideoRuleCaptureOrigin = "FIRST_AUTOMATIC_REVIEW" | "LEGACY_APPEAL";

export function videoRuleRevision(rule: VideoPointRuleConfig) {
  if (Object.values(asVideoPointRuleConfig(rule)).some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new Error("视频积分规则只能使用正整数");
  }
  // Fixed key order, formula version included. A -> B -> A returns the same calculation identity;
  // capturedAt/sourceUpdatedAt identify the individual adoption of that configuration.
  return createHash("sha256").update(JSON.stringify({ formulaVersion: VIDEO_POINT_FORMULA_VERSION, ...asVideoPointRuleConfig(rule) })).digest("hex");
}

export function snapshotRule(snapshot: VideoPointRuleSnapshot): VideoPointRuleConfig {
  if (snapshot.formulaVersion !== VIDEO_POINT_FORMULA_VERSION || snapshot.revision !== videoRuleRevision(snapshot)) {
    throw new Error("视频积分规则快照校验失败，暂不能结算");
  }
  return asVideoPointRuleConfig(snapshot);
}

export function calculateSnapshotVideoPoints(likes: number, snapshot: VideoPointRuleSnapshot) {
  const rule = snapshotRule(snapshot);
  // Frozen likes-v1 contract. Future formulas need another version and must keep this evaluator.
  if (!Number.isFinite(likes) || likes < rule.minimumLikes) return 0;
  if (likes <= rule.fixedTierMaxLikes) return rule.fixedTierPoints;
  return Math.min(rule.maximumPoints, Math.floor(likes / rule.likesDivisor));
}

export function videoRulePreview(snapshot: VideoPointRuleSnapshot, likes: number | null) {
  return {
    revision: snapshot.revision,
    capturedAt: snapshot.capturedAt.toISOString(),
    historicalFallback: snapshot.origin === "LEGACY_APPEAL",
    maximumPoints: snapshotRule(snapshot).maximumPoints,
    defaultPoints: calculateSnapshotVideoPoints(likes ?? 0, snapshot),
  };
}

export function videoRuleEvidence(snapshot: VideoPointRuleSnapshot | null, likes: number | null, awardedPoints?: number) {
  if (!snapshot) return { ruleEvidence: "UNAVAILABLE" as const, likes, awardedPoints: awardedPoints ?? null };
  const rule = snapshotRule(snapshot);
  const calculatedPoints = likes === null ? null : calculateSnapshotVideoPoints(likes, snapshot);
  return {
    revision: snapshot.revision,
    formulaVersion: snapshot.formulaVersion,
    origin: snapshot.origin,
    capturedAt: snapshot.capturedAt.toISOString(),
    sourceUpdatedAt: snapshot.sourceUpdatedAt?.toISOString() ?? null,
    rule,
    likes,
    rounding: "floor" as const,
    calculatedPoints,
    awardedPoints: awardedPoints ?? null,
    awardDiffersFromFormula: awardedPoints !== undefined && awardedPoints !== calculatedPoints,
  };
}

export async function captureVideoPointRule(
  videoId: string,
  origin: VideoRuleCaptureOrigin,
  transaction?: Prisma.TransactionClient,
): Promise<VideoPointRuleSnapshot> {
  const capture = async (tx: Prisma.TransactionClient) => {
    const existing = await tx.videoPointRuleSnapshot.findUnique({ where: { videoId } });
    if (existing) { snapshotRule(existing); return existing; }
    // Serializes first capture only. Never held over external fetches or waiting on the queue.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`video-rule:${videoId}`})::bigint)`;
    const repeated = await tx.videoPointRuleSnapshot.findUnique({ where: { videoId } });
    if (repeated) { snapshotRule(repeated); return repeated; }
    const video = await tx.videoSubmission.findUniqueOrThrow({ where: { id: videoId }, select: { status: true, likes: true } });
    const allowed = origin === "LEGACY_APPEAL" ? ["REJECTED"] : ["PROCESSING", "PENDING_REVIEW", "FAILED"];
    if (!allowed.includes(video.status)) throw new Error("当前视频状态不能首次锁定积分规则");
    const current = await tx.videoPointRule.findUnique({ where: { id: "default" } });
    const rule = asVideoPointRuleConfig(current ?? DEFAULT_VIDEO_POINT_RULE);
    const snapshot = await tx.videoPointRuleSnapshot.create({ data: {
      videoId, origin, ...rule, revision: videoRuleRevision(rule),
      formulaVersion: VIDEO_POINT_FORMULA_VERSION, sourceUpdatedAt: current?.updatedAt ?? null,
    } });
    await tx.auditLog.create({ data: {
      action: "VIDEO_POINT_RULE_CAPTURED", entity: "VideoSubmission", entityId: videoId,
      beforeValue: { status: video.status, ruleEvidence: "UNAVAILABLE" },
      afterValue: videoRuleEvidence(snapshot, video.likes),
      reason: origin === "LEGACY_APPEAL" ? "历史记录无原始规则，申诉时明确采用当前规则；不代表原审核规则" : "首次自动审核锁定规则；重试、重新抓取和申诉沿用",
    } });
    return snapshot;
  };
  return transaction ? capture(transaction) : db.$transaction(capture);
}

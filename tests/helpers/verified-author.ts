import { randomUUID } from "node:crypto";
import { db } from "../../lib/db";
import { videoPlatform } from "../../lib/platform-bindings";

/** Synthetic precondition for financial tests; never imported by application code. */
export async function seedVerifiedVideoAuthor(videoId: string) {
  return db.$transaction(async (tx) => {
    const video = await tx.videoSubmission.findUniqueOrThrow({ where: { id: videoId } });
    const platform = videoPlatform(video.sourceKind);
    const authorUid = `fixture_${video.userId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`platform-author:${platform}:${authorUid}`})::bigint)`;
    const updated = await tx.videoSubmission.update({ where: { id: video.id }, data: {
      fetchedAuthorUid: authorUid, authorEvidenceVersion: 1,
      metadataFetchedAt: new Date(), photoId: video.photoId ?? `fixture_${randomUUID()}`,
    } });
    const binding = await tx.platformAccountBinding.findUnique({ where: { platform_authorUid: { platform, authorUid } } });
    if (!binding) {
      const request = await tx.platformBindingRequest.create({ data: {
        userId: video.userId, platform, authorUid, videoId: video.id, photoId: updated.photoId!,
        challenge: `fixture_${randomUUID()}`, status: "APPROVED", expiresAt: new Date(Date.now() + 3600_000),
        reviewedAt: new Date(), reviewedById: "synthetic-fixture", proofMethod: "PROFILE_CHALLENGE",
        proofNote: "Synthetic fixture only: test account ownership precondition, no real platform claim.",
      } });
      await tx.platformAccountBinding.create({ data: { userId: video.userId, platform, authorUid, requestId: request.id, verifiedById: "synthetic-fixture" } });
    }
    return updated;
  });
}

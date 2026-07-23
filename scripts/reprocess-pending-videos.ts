import { db } from "../lib/db";
import { processVideoSubmission } from "../lib/video-jobs";

const apply = process.argv.includes("--apply");
const includeMismatches = process.argv.includes("--include-mismatches");
const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const limit = Math.min(200, Math.max(1, Number(limitArgument?.split("=")[1] ?? 50) || 50));

async function main() {
  const candidates = await db.videoSubmission.findMany({
    where: {
      OR: [
        { status: "FAILED" },
        {
          status: "PENDING_REVIEW",
          OR: [
            { matchedOwner: null },
            { fetchedOwner: null },
            { photoId: null },
            ...(includeMismatches ? [{ matchedOwner: false }] : []),
          ],
        },
      ],
    },
    orderBy: { submittedAt: "asc" },
    take: limit,
    select: {
      id: true,
      status: true,
      submittedAt: true,
      submittedNickname: true,
      user: { select: { kuaishouId: true } },
    },
  });

  if (!apply) {
    console.log(JSON.stringify({
      mode: "dry-run",
      count: candidates.length,
      candidates,
      next: "确认目标后增加 --apply 执行；脚本会重新抓取，不会无条件通过。",
    }, null, 2));
    return;
  }

  const results = [];
  for (const candidate of candidates) {
    await db.$transaction(async (tx) => {
      const claimed = await tx.videoSubmission.updateMany({
        where: { id: candidate.id, status: { in: ["PENDING_REVIEW", "FAILED"] } },
        data: { status: "PROCESSING", reviewReason: null },
      });
      if (claimed.count !== 1) return;
      await tx.auditLog.create({
        data: {
          action: "VIDEO_BULK_REPROCESS_REQUESTED",
          entity: "VideoSubmission",
          entityId: candidate.id,
          beforeValue: { status: candidate.status },
          afterValue: { status: "PROCESSING", source: "reprocess-pending-videos" },
          reason: "上线前自动审核测试",
        },
      });
    });

    try {
      await processVideoSubmission(candidate.id);
    } catch {
      // processVideoSubmission persists an automatic REJECTED result when
      // retries are exhausted; a later run can still inspect the audit trail.
    }
    const final = await db.videoSubmission.findUniqueOrThrow({
      where: { id: candidate.id },
      select: {
        id: true,
        status: true,
        likes: true,
        views: true,
        points: true,
        photoId: true,
        fetchedOwner: true,
        matchedOwner: true,
        reviewReason: true,
      },
    });
    results.push(final);
    console.log(JSON.stringify(final));
  }

  const summary = results.reduce<Record<string, number>>((counts, result) => {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    return counts;
  }, {});
  console.log(JSON.stringify({ mode: "apply", count: results.length, summary }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

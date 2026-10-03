import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/db";
import { fetchKuaishouVideo } from "../lib/kuaishou-fetch";
import { fetchDouyinVideo, closeDouyinBrowser } from "../lib/douyin-fetch";
import { isDouyinSourceKind } from "../lib/douyin";
import { videoEligibilityError } from "../lib/kuaishou";
import { getVideoPointRule } from "../lib/point-rules";
import { calculateSnapshotVideoPoints, snapshotRule, videoRuleEvidence } from "../lib/video-point-rule-snapshots";

const concurrencyArgument = process.argv.find((argument) => argument.startsWith("--concurrency="));
const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const concurrency = Math.min(8, Math.max(1, Number(concurrencyArgument?.split("=")[1] ?? 4) || 4));
const limit = Math.min(10_000, Math.max(1, Number(limitArgument?.split("=")[1] ?? 10_000) || 10_000));

type AuditResult = {
  id: string;
  sourceKind: string;
  outcome: "ok" | "warning" | "error";
  issues: string[];
  stored: { likes: number | null; points: number; photoId: string | null; submittedNickname: string };
  fetched?: { likes: number; points: number; photoId: string; owner: string; ownerMatches: boolean; ownerMatchMethod: string };
  error?: string;
  calculation?: ReturnType<typeof videoRuleEvidence>;
};

async function main() {
  const [rule, rows] = await Promise.all([
    getVideoPointRule(),
    db.videoSubmission.findMany({
      where: { status: "APPROVED" },
      orderBy: { submittedAt: "asc" },
      take: limit,
      select: {
        id: true,
        sourceUrl: true,
        sourceKind: true,
        likes: true,
        points: true,
        photoId: true,
        submittedNickname: true,
        submittedAt: true,
        pointRuleSnapshot: true,
      },
    }),
  ]);

  let cursor = 0;
  let finished = 0;
  const results = new Array<AuditResult>(rows.length);
  async function runWorker() {
    while (true) {
      const index = cursor++;
      if (index >= rows.length) return;
      const row = rows[index];
      try {
        const lockedRule = row.pointRuleSnapshot ? snapshotRule(row.pointRuleSnapshot) : null;
        const fetched = isDouyinSourceKind(row.sourceKind)
          ? await fetchDouyinVideo(row.sourceUrl, row.submittedNickname, lockedRule ?? rule)
          : await fetchKuaishouVideo(row.sourceUrl, row.submittedNickname, lockedRule ?? rule);
        const issues: string[] = [];
        if (!fetched.ownerMatches) issues.push("owner-mismatch");
        if (row.photoId && row.photoId !== fetched.photoId) issues.push("photo-id-mismatch");
        if (!lockedRule) issues.push("historical-rule-unavailable");
        if (row.pointRuleSnapshot && row.likes !== null && row.points !== calculateSnapshotVideoPoints(row.likes, row.pointRuleSnapshot)) issues.push("stored-points-differ-from-locked-formula:check-appeal-or-adjustment-audit");
        const eligibility = videoEligibilityError(fetched.likes, fetched.publishedAt, row.submittedAt, lockedRule ?? rule);
        if (eligibility) issues.push(`${lockedRule ? "locked-rule-probe" : "current-rule-probe-only"}:${eligibility}`);
        results[index] = {
          id: row.id,
          sourceKind: row.sourceKind,
          outcome: issues.length ? "warning" : "ok",
          issues,
          calculation: videoRuleEvidence(row.pointRuleSnapshot, row.likes, row.points),
          stored: { likes: row.likes, points: row.points, photoId: row.photoId, submittedNickname: row.submittedNickname },
          fetched: {
            likes: fetched.likes,
            points: fetched.points,
            photoId: fetched.photoId,
            owner: fetched.owner,
            ownerMatches: fetched.ownerMatches,
            ownerMatchMethod: fetched.ownerMatchMethod,
          },
        };
      } catch (error) {
        results[index] = {
          id: row.id,
          sourceKind: row.sourceKind,
          outcome: "error",
          issues: ["fetch-or-parse-failed"],
          stored: { likes: row.likes, points: row.points, photoId: row.photoId, submittedNickname: row.submittedNickname },
          error: error instanceof Error ? error.message : "未知错误",
        };
      }
      finished += 1;
      if (finished % 10 === 0 || finished === rows.length) {
        console.log(`[approved-audit] ${finished}/${rows.length}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length || 1) }, () => runWorker()));
  const summary = results.reduce<Record<string, number>>((counts, result) => {
    counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
    for (const issue of result.issues) {
      const key = `issue:${issue.split(":")[0]}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, {});
  const errorReasons = results
    .filter((result) => result.error)
    .reduce<Record<string, number>>((counts, result) => {
      const message = result.error ?? "未知错误";
      counts[message] = (counts[message] ?? 0) + 1;
      return counts;
    }, {});
  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    concurrency,
    currentRuleForUnknownHistoryProbeOnly: rule,
    count: rows.length,
    summary,
    errorReasons,
    badCases: results.filter((result) => result.outcome !== "ok"),
  };
  const outputDirectory = path.resolve(process.cwd(), "output", "audit");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, "approved-video-audit.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ outputPath, count: rows.length, summary, errorReasons }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => { await closeDouyinBrowser(); await db.$disconnect(); });

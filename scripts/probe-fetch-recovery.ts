import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/db";
import { parseKuaishouHtml, runCurl } from "../lib/kuaishou-fetch";
import { normalizeKuaishouLink } from "../lib/kuaishou";

const limit = Math.min(50, Math.max(1, Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 10) || 10));
const attempts = Math.min(12, Math.max(2, Number(process.argv.find((arg) => arg.startsWith("--attempts="))?.split("=")[1] ?? 10) || 10));
const delayMs = Math.min(10_000, Math.max(250, Number(process.argv.find((arg) => arg.startsWith("--delay-ms="))?.split("=")[1] ?? 1_000) || 1_000));
const concurrency = Math.min(5, Math.max(1, Number(process.argv.find((arg) => arg.startsWith("--concurrency="))?.split("=")[1] ?? 4) || 4));

type Probe = {
  attempt: number;
  recovered: boolean;
  bytes: number;
  error?: string;
};

async function probe(sourceUrl: string) {
  let requestUrl: string;
  try {
    requestUrl = normalizeKuaishouLink(sourceUrl).requestUrl;
  } catch (error) {
    return [{ attempt: 0, recovered: false, bytes: 0, error: error instanceof Error ? error.message : "链接无效" }];
  }
  const rounds: Probe[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      const html = await runCurl(requestUrl);
      parseKuaishouHtml(html);
      rounds.push({ attempt, recovered: true, bytes: html.length });
    } catch (error) {
      rounds.push({ attempt, recovered: false, bytes: 0, error: error instanceof Error ? error.message : "解析失败" });
    }
  }
  return rounds;
}

async function main() {
  const reportPath = path.resolve(process.cwd(), "output", "audit", "approved-video-audit.json");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as { badCases: Array<{ id: string; outcome: string }> };
  const errorIds = report.badCases.filter((item) => item.outcome === "error").slice(0, limit).map((item) => item.id);
  const rows = await db.videoSubmission.findMany({
    where: { id: { in: errorIds } },
    select: { id: true, sourceUrl: true, shortCode: true },
  });
  let cursor = 0;
  const results: Array<Record<string, unknown>> = [];
  async function worker() {
    while (true) {
      const row = rows[cursor++];
      if (!row) return;
      const rounds = await probe(row.sourceUrl);
      const firstRecovery = rounds.find((round) => round.recovered)?.attempt ?? null;
      results.push({ id: row.id, shortCode: row.shortCode, firstRecovery, rounds });
      console.log(`[fetch-recovery] ${results.length}/${rows.length} ${row.id} first=${firstRecovery ?? "none"}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length || 1) }, () => worker()));
  const summary = {
    count: results.length,
    recovered: results.filter((row) => row.firstRecovery !== null).length,
    neverRecovered: results.filter((row) => row.firstRecovery === null).length,
    firstRecoveryAttempts: results.reduce<Record<string, number>>((counts, row) => {
      if (row.firstRecovery !== null) {
        const key = String(row.firstRecovery);
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return counts;
    }, {}),
  };
  const outputDirectory = path.resolve(process.cwd(), "output", "audit");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, "fetch-recovery-probe.json");
  fs.writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), attempts, delayMs, concurrency, summary, results }, null, 2), "utf8");
  console.log(JSON.stringify({ outputPath, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());

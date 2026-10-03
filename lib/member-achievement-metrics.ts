import type { Prisma } from "@prisma/client";
import { periodBounds } from "./rankings";

export function consecutiveMonthKeys(keys: string[]) {
  let best = 0;
  let current = 0;
  let previous = -Infinity;
  for (const key of [...new Set(keys)].sort()) {
    const [year, month] = key.split("-").map(Number);
    const ordinal = year * 12 + month;
    current = ordinal === previous + 1 ? current + 1 : 1;
    best = Math.max(best, current);
    previous = ordinal;
  }
  return best;
}

function number(value: bigint, stored = false) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || (stored && result > 2_147_483_647)) throw new Error("GROWTH_METRIC_OUT_OF_RANGE");
  return result;
}

export async function readAchievementMetrics(tx: Prisma.TransactionClient, userId: string, reference: Date) {
  const monthStart = periodBounds("month", reference).start;
  const windowStart = new Date(monthStart.getTime() - 56 * 86_400_000);
  const [row] = await tx.$queryRaw<Array<{
    videos: bigint; likes: bigint; views: bigint; experience: bigint; months: string[];
    baselineVideos: bigint; baselineEngagement: bigint; progressVideos: bigint; progressEngagement: bigint;
  }>>`
    WITH source AS (
      SELECT "submittedAt", COALESCE("likes", 0)::bigint AS likes,
        COALESCE("views", 0)::bigint AS views, COALESCE("commentCount", 0)::bigint AS comments
      FROM "VideoSubmission" WHERE "userId" = ${userId} AND "status" = 'APPROVED'
    ), metrics AS (
      SELECT *, likes + FLOOR(views / 100.0)::bigint + comments * 10 AS engagement,
        "submittedAt" >= (${windowStart}::timestamptz AT TIME ZONE 'UTC')
          AND "submittedAt" < (${monthStart}::timestamptz AT TIME ZONE 'UTC') AS baseline,
        "submittedAt" >= (${monthStart}::timestamptz AT TIME ZONE 'UTC')
          AND "submittedAt" <= (${reference}::timestamptz AT TIME ZONE 'UTC') AS current_month
      FROM source
    )
    SELECT COUNT(*)::bigint AS videos, COALESCE(SUM(likes), 0)::bigint AS likes,
      COALESCE(SUM(views), 0)::bigint AS views,
      COALESCE(SUM(100 + FLOOR(likes / 100.0)::bigint + FLOOR(views / 1000.0)::bigint + comments * 5), 0)::bigint AS experience,
      COALESCE(ARRAY_AGG(DISTINCT TO_CHAR(("submittedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM')), ARRAY[]::text[]) AS months,
      COUNT(*) FILTER (WHERE baseline)::bigint AS "baselineVideos",
      COALESCE(SUM(engagement) FILTER (WHERE baseline), 0)::bigint AS "baselineEngagement",
      COUNT(*) FILTER (WHERE current_month)::bigint AS "progressVideos",
      COALESCE(SUM(engagement) FILTER (WHERE current_month), 0)::bigint AS "progressEngagement"
    FROM metrics
  `;
  const baselineVideos = Math.ceil(number(row.baselineVideos, true) / 2);
  const baselineEngagement = Math.ceil(number(row.baselineEngagement, true) / 2);
  return {
    monthStart,
    experience: number(row.experience, true),
    metrics: { videos: number(row.videos), likes: number(row.likes), views: number(row.views), months: consecutiveMonthKeys(row.months) },
    targets: { baselineVideos, baselineEngagement, targetVideos: Math.max(1, Math.ceil(baselineVideos * 1.1)), targetEngagement: Math.max(100, Math.ceil(baselineEngagement * 1.1)) },
    progress: { videos: number(row.progressVideos, true), engagement: number(row.progressEngagement, true) },
  };
}

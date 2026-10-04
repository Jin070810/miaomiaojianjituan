import { Prisma } from "@prisma/client";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type RankingKind = "week" | "month" | "total";

function localParts(value: Date) {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay(),
  };
}

function shanghaiDate(year: number, month: number, date: number) {
  return new Date(Date.UTC(year, month, date) - SHANGHAI_OFFSET_MS);
}

export function periodBounds(kind: Exclude<RankingKind, "total">, reference = new Date()) {
  const parts = localParts(reference);
  if (kind === "month") {
    const start = shanghaiDate(parts.year, parts.month, 1);
    return { start, end: shanghaiDate(parts.year, parts.month + 1, 1) };
  }
  const mondayOffset = (parts.day + 6) % 7;
  const start = shanghaiDate(parts.year, parts.month, parts.date - mondayOffset);
  return { start, end: new Date(start.getTime() + WEEK_MS) };
}

// One lock per Shanghai ranking period, even if its row has not been created.
// Revocation takes WEEK then MONTH; settlement takes only its own period.
export async function lockRankingPeriod(tx: Prisma.TransactionClient, kind: Exclude<RankingKind, "total">, reference: Date) {
  const start = periodBounds(kind, reference).start;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ranking:${kind}:${start.toISOString()}`}, 0))`;
}

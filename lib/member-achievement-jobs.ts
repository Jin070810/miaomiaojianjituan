import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { reconcileMemberAchievements } from "./member-achievements";
import { periodBounds } from "./rankings";

export type AchievementRefreshClaim = { userId: string; generation: bigint; failures: number; leaseToken: string };
class StaleRefreshClaim extends Error {}

// Only the claim and final fence lock the outbox row. A source/points transaction
// can advance generation while the projection is being calculated.
export async function claimMemberAchievementRefresh(userId?: string): Promise<AchievementRefreshClaim | null> {
  const leaseToken = crypto.randomUUID();
  return db.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<Array<{ userId: string; generation: bigint; failures: number }>>`
      SELECT "userId", "generation", "failures" FROM "MemberAchievementRefresh"
      WHERE "pending" = TRUE AND "availableAt" <= (clock_timestamp() AT TIME ZONE 'UTC')
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC'))
        ${userId ? Prisma.sql`AND "userId" = ${userId}` : Prisma.empty}
      ORDER BY "availableAt", "requestedAt", "userId" LIMIT 1 FOR UPDATE SKIP LOCKED
    `;
    if (!row) return null;
    await tx.$executeRaw`UPDATE "MemberAchievementRefresh" SET "leaseToken" = ${leaseToken},
      "leaseExpiresAt" = (clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '60 seconds' WHERE "userId" = ${row.userId}`;
    return { ...row, leaseToken };
  }, { timeout: 5_000 });
}

export async function processMemberAchievementRefresh(claim: AchievementRefreshClaim, reference = new Date()) {
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '10s'`;
      await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
      await tx.$executeRaw`SET LOCAL idle_in_transaction_session_timeout = '15s'`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(746310, hashtext(${claim.userId}))::text`;
      const [valid] = await tx.$queryRaw<Array<{ userId: string }>>`SELECT "userId" FROM "MemberAchievementRefresh"
        WHERE "userId" = ${claim.userId} AND "leaseToken" = ${claim.leaseToken}
          AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') AND "pending" = TRUE`;
      if (!valid) throw new StaleRefreshClaim();
      await reconcileMemberAchievements(tx, claim.userId, reference);
      const committed = await tx.$executeRaw`
        UPDATE "MemberAchievementRefresh" SET "appliedGeneration" = ${claim.generation},
          "pending" = ("generation" > ${claim.generation}), "leaseToken" = NULL, "leaseExpiresAt" = NULL,
          "availableAt" = (clock_timestamp() AT TIME ZONE 'UTC'), "failures" = 0, "lastFailureCode" = NULL,
          "completedAt" = (${reference}::timestamptz AT TIME ZONE 'UTC')
        WHERE "userId" = ${claim.userId} AND "leaseToken" = ${claim.leaseToken}
          AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
      `;
      if (committed !== 1) throw new StaleRefreshClaim();
    }, { timeout: 15_000, maxWait: 5_000 });
    return { status: "processed" as const };
  } catch (error) {
    if (error instanceof StaleRefreshClaim) return { status: "stale" as const };
    const failureCode = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "REBUILD_FAILED";
    const retrySeconds = Math.min(900, 5 * 2 ** Math.min(claim.failures, 8));
    await db.$executeRaw`
      UPDATE "MemberAchievementRefresh" SET "leaseToken" = NULL, "leaseExpiresAt" = NULL,
        "availableAt" = CASE WHEN "generation" = ${claim.generation}
          THEN (clock_timestamp() AT TIME ZONE 'UTC') + (${retrySeconds} * INTERVAL '1 second') ELSE "availableAt" END,
        "failures" = CASE WHEN "generation" = ${claim.generation} THEN LEAST("failures" + 1, 1000) ELSE 0 END,
        "lastFailureCode" = CASE WHEN "generation" = ${claim.generation} THEN ${failureCode} ELSE NULL END
      WHERE "userId" = ${claim.userId} AND "leaseToken" = ${claim.leaseToken}
    `;
    return { status: "failed" as const, code: failureCode };
  }
}

export async function runMemberAchievementRefreshBatch(options: { limit?: number; reference?: Date } = {}) {
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const started = Date.now();
  const result = { processed: 0, failed: 0, stale: 0 };
  for (let i = 0; i < limit && Date.now() - started < 5_000; i += 1) {
    const claim = await claimMemberAchievementRefresh();
    if (!claim) break;
    const outcome = await processMemberAchievementRefresh(claim, options.reference);
    result[outcome.status] += 1;
  }
  return result;
}

// A bounded repair sweep covers a new month, old deployment omissions and a
// daily rebuild. Pending rows keep their current generation/lease/backoff.
export async function enqueueStaleAchievementProjections(reference = new Date(), limit = 100, userId?: string) {
  const monthStart = periodBounds("month", reference).start;
  const cutoff = new Date(reference.getTime() - 24 * 60 * 60 * 1_000);
  const rows = await db.$queryRaw<Array<{ userId: string }>>`
    SELECT u."id" AS "userId" FROM "User" u
    LEFT JOIN "MemberGrowthProfile" p ON p."userId" = u."id"
    LEFT JOIN "MemberMonthlyGoal" g ON g."userId" = u."id" AND g."monthStart" = (${monthStart}::timestamptz AT TIME ZONE 'UTC')
    LEFT JOIN "MemberAchievementRefresh" r ON r."userId" = u."id"
    WHERE u."active" = TRUE AND u."role" IN ('MEMBER', 'REVIEWER')
      ${userId ? Prisma.sql`AND u."id" = ${userId}` : Prisma.empty}
      AND (r."pending" = FALSE OR r."userId" IS NULL)
      AND (p."userId" IS NULL OR g."calculatedAt" IS NULL OR p."calculatedAt" < (${cutoff}::timestamptz AT TIME ZONE 'UTC'))
    ORDER BY u."id" LIMIT ${Math.min(1000, Math.max(1, limit))}
  `;
  for (const row of rows) await db.$queryRaw`SELECT request_member_achievement_refresh(${row.userId})::text`;
  return { enqueued: rows.length };
}

export async function getAchievementRefreshStatus() {
  const [pending, delayed, oldest] = await Promise.all([
    db.memberAchievementRefresh.count({ where: { pending: true } }),
    db.memberAchievementRefresh.count({ where: { pending: true, failures: { gt: 0 } } }),
    db.memberAchievementRefresh.findFirst({ where: { pending: true }, orderBy: { requestedAt: "asc" }, select: { requestedAt: true } }),
  ]);
  return { pending, delayed, oldestRequestedAt: oldest?.requestedAt ?? null };
}

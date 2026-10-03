import { Prisma } from "@prisma/client";
import { db } from "./db";

// Both commands share this read-only contract. The wrapper guarantees that
// account balances and ledger totals describe the same committed snapshot.
export async function inspectFinancialIntegrity() {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return readFinancialIntegrity(tx);
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 5_000,
    timeout: 60_000,
  });
}

export async function readFinancialIntegrity(tx: Prisma.TransactionClient) {
  const accounts = await tx.pointAccount.findMany({ select: { id: true, userId: true, balance: true } });
  const ledgerTotals = await tx.pointLedger.groupBy({ by: ["accountId"], _sum: { amount: true } });
  const totals = new Map(ledgerTotals.map(row => [row.accountId, row._sum.amount ?? 0]));
  const balanceMismatches = accounts
    .filter(account => account.balance !== (totals.get(account.id) ?? 0))
    .map(account => ({ userId: account.userId, accountId: account.id, balance: account.balance, ledgerTotal: totals.get(account.id) ?? 0 }));
  const negativeBalances = accounts.filter(account => account.balance < 0)
    .map(account => ({ userId: account.userId, accountId: account.id, balance: account.balance }));

  // A type name alone is insufficient: require the matching credited source,
  // its audit trail, no over-reversal, and no ordinary debit below zero.
  // Race winner rows can be reassigned; the original assignment and ledger
  // identity are used instead of the current winner's userId.
  const debtEntries = negativeBalances.length ? await tx.$queryRaw<Array<{
    id: string; accountId: string; referenceId: string | null; sourceVerified: boolean;
  }>>`
    SELECT debit.id, debit."accountId", debit."referenceId",
      (
        EXISTS (
          SELECT 1 FROM "PointLedger" reward
          WHERE reward."accountId" = debit."accountId" AND reward."referenceId" = debit."referenceId" AND reward.amount > 0
            AND (
              (debit.type = 'REVERSAL' AND reward.type IN ('VIDEO_REWARD', 'BIRTHDAY_VIDEO_BONUS', 'ADMIN_ADJUSTMENT'))
              OR (debit.type = 'ADMIN_ADJUSTMENT' AND reward.type IN ('VIDEO_REWARD', 'ADMIN_ADJUSTMENT'))
              OR (debit.type = 'WEEKLY_CHALLENGE_REVERSAL' AND reward.type = 'WEEKLY_CHALLENGE_REWARD')
              OR (debit.type = 'WEEKLY_RACE_REVERSAL' AND reward.type = 'WEEKLY_RACE_REWARD')
            )
        )
        AND (SELECT SUM(related.amount) FROM "PointLedger" related
          WHERE related."accountId" = debit."accountId" AND related."referenceId" = debit."referenceId") >= 0
        AND (
          (debit.type IN ('REVERSAL', 'ADMIN_ADJUSTMENT') AND EXISTS (
            SELECT 1 FROM "VideoSubmission" video JOIN "AuditLog" audit ON audit."entityId" = video.id
            WHERE video.id = debit."referenceId" AND video."userId" = account."userId" AND audit.entity = 'VideoSubmission'
              AND ((debit.type = 'REVERSAL' AND audit.action = 'VIDEO_REVOKED')
                OR (debit.type = 'ADMIN_ADJUSTMENT' AND audit.action = 'VIDEO_POINTS_ADJUSTED' AND audit."actorId" IS NOT NULL))
          ))
          OR (debit.type = 'WEEKLY_CHALLENGE_REVERSAL' AND EXISTS (
            SELECT 1 FROM "WeeklyChallengeAssignment" assignment JOIN "AuditLog" audit ON audit."entityId" = assignment.id
            WHERE assignment.id = debit."referenceId" AND assignment."userId" = account."userId"
              AND audit.entity = 'WeeklyChallengeAssignment' AND audit.action IN ('WEEKLY_CHALLENGE_REVERSED', 'WEEKLY_CHALLENGE_TIER_DOWNGRADED')
          ))
          OR (debit.type = 'WEEKLY_RACE_REVERSAL' AND EXISTS (
            SELECT 1 FROM "WeeklyChallengeAssignment" assignment JOIN "AuditLog" audit ON audit."entityId" = assignment.id
            WHERE assignment."userId" = account."userId"
              AND debit."idempotencyKey" = 'weekly-race:' || assignment."periodId" || ':reversal:' || assignment.id
              AND audit.entity = 'WeeklyChallengeAssignment' AND audit.action IN ('WEEKLY_CHALLENGE_REVERSED', 'WEEKLY_CHALLENGE_TIER_DOWNGRADED')
          ))
        )
      ) AS "sourceVerified"
    FROM "PointLedger" debit JOIN "PointAccount" account ON account.id = debit."accountId"
    WHERE account.balance < 0 AND debit.amount < 0 AND debit."balanceAfter" < 0
  ` : [];
  const evidence = new Map<string, typeof debtEntries>();
  for (const entry of debtEntries) {
    const rows = evidence.get(entry.accountId) ?? [];
    rows.push(entry);
    evidence.set(entry.accountId, rows);
  }
  const mismatchIds = new Set(balanceMismatches.map(row => row.accountId));
  const isCompensatingDebt = (accountId: string) => {
    const rows = evidence.get(accountId) ?? [];
    return !mismatchIds.has(accountId) && rows.length > 0 && rows.every(row => row.sourceVerified === true);
  };
  const compensatingDebts = negativeBalances.filter(row => isCompensatingDebt(row.accountId))
    .map(row => ({ ...row, ledgerIds: evidence.get(row.accountId)!.map(entry => entry.id) }));
  const unexplainedNegativeBalances = negativeBalances.filter(row => !isCompensatingDebt(row.accountId));

  const invalidOrders = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT orders.id FROM "RedemptionOrder" orders
    LEFT JOIN "BirthdayPrize" prize ON prize.id = orders."birthdayPrizeId"
    LEFT JOIN "BirthdayAnnualBenefit" benefit ON benefit.id = prize."annualBenefitId"
    WHERE orders.quantity < 1 OR orders."unitCost" < 0 OR orders."totalCost" < 0
      OR orders."totalCost"::bigint <> orders.quantity::bigint * orders."unitCost"::bigint
      OR (orders."birthdayPrizeId" IS NULL AND orders."unitCost" < 1)
      OR (orders."birthdayPrizeId" IS NOT NULL AND (
        orders.quantity = 1 AND orders."unitCost" = 0 AND orders."totalCost" = 0
        AND prize.kind = 'GIFT' AND prize.status = 'CLAIMED'
        AND prize."giftId" = orders."giftId" AND benefit."userId" = orders."userId"
      ) IS NOT TRUE)
    ORDER BY orders.id LIMIT 20
  `;
  const duplicatePhotoIds = await tx.$queryRaw<Array<{ photoId: string; count: bigint }>>`
    SELECT "photoId", COUNT(*)::bigint AS count FROM "VideoSubmission"
    WHERE "photoId" IS NOT NULL AND status IN ('PROCESSING', 'PENDING_REVIEW', 'APPROVED')
    GROUP BY "photoId" HAVING COUNT(*) > 1
  `;
  const invalidGifts = await tx.gift.findMany({
    where: { OR: [{ stock: { lt: 0 } }, { pointsCost: { lt: 1 } }] },
    select: { id: true, stock: true, pointsCost: true },
  });
  const nonIntegerPoints = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "PointLedger"
    WHERE amount <> TRUNC(amount::numeric) OR "balanceAfter" <> TRUNC("balanceAfter"::numeric)
    LIMIT 20
  `;
  return {
    accounts: accounts.length, balanceMismatches, negativeBalances, compensatingDebts, unexplainedNegativeBalances,
    duplicatePhotoIds: duplicatePhotoIds.map(row => ({ photoId: row.photoId, count: Number(row.count) })),
    invalidGifts, invalidOrders, nonIntegerPoints,
    pendingAppeals: await tx.videoAppeal.count({ where: { status: "PENDING" } }),
    hasErrors: Boolean(balanceMismatches.length || unexplainedNegativeBalances.length || duplicatePhotoIds.length || invalidGifts.length || invalidOrders.length || nonIntegerPoints.length),
  };
}

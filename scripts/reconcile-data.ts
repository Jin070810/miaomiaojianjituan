import "dotenv/config";
import { db } from "../lib/db";

async function main() {
  const accounts = await db.pointAccount.findMany({ select: { id: true, userId: true, balance: true } });
  const ledgerTotals = await db.pointLedger.groupBy({ by: ["accountId"], _sum: { amount: true } });
  const totalByAccount = new Map(ledgerTotals.map((row) => [row.accountId, row._sum.amount ?? 0]));
  const balanceMismatches = accounts
    .filter((account) => account.balance !== (totalByAccount.get(account.id) ?? 0))
    .map((account) => ({ userId: account.userId, accountId: account.id, balance: account.balance, ledgerTotal: totalByAccount.get(account.id) ?? 0 }));
  const negativeBalances = accounts
    .filter((account) => account.balance < 0)
    .map((account) => ({ userId: account.userId, accountId: account.id, balance: account.balance }));

  const duplicatePhotoIds = await db.$queryRaw<Array<{ photoId: string; count: bigint }>>`
    SELECT "photoId", COUNT(*)::bigint AS count
    FROM "VideoSubmission"
    WHERE "photoId" IS NOT NULL AND "status" IN ('PROCESSING', 'PENDING_REVIEW', 'APPROVED')
    GROUP BY "photoId"
    HAVING COUNT(*) > 1
  `;
  const pendingAppeals = await db.videoAppeal.count({ where: { status: "PENDING" } });
  const invalidGifts = await db.gift.findMany({ where: { OR: [{ stock: { lt: 0 } }, { pointsCost: { lt: 1 } }] }, select: { id: true, stock: true, pointsCost: true } });
  const invalidOrders = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "RedemptionOrder"
    WHERE quantity < 1 OR "unitCost" < 1 OR "totalCost" <> quantity * "unitCost"
    LIMIT 20
  `;
  const nonIntegerPoints = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "PointLedger" WHERE amount <> TRUNC(amount::numeric) OR "balanceAfter" <> TRUNC("balanceAfter"::numeric)
    LIMIT 20
  `;
  const report = {
    generatedAt: new Date().toISOString(),
    accounts: accounts.length,
    balanceMismatches,
    negativeBalances,
    duplicatePhotoIds: duplicatePhotoIds.map((row) => ({ photoId: row.photoId, count: Number(row.count) })),
    pendingAppeals,
    invalidGifts,
    invalidOrders,
    nonIntegerPoints,
  };
  console.log(JSON.stringify(report, null, 2));
  if (balanceMismatches.length || negativeBalances.length || duplicatePhotoIds.length || invalidGifts.length || invalidOrders.length || nonIntegerPoints.length) process.exitCode = 1;
}

main().finally(() => db.$disconnect());

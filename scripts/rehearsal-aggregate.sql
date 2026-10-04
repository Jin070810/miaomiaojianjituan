\set ON_ERROR_STOP on
SELECT json_build_object(
  'users',(SELECT count(*) FROM "User"),
  'videos',(SELECT count(*) FROM "VideoSubmission"),
  'accounts',(SELECT count(*) FROM "PointAccount"),
  'ledgerRows',(SELECT count(*) FROM "PointLedger"),
  'balanceTotal',(SELECT coalesce(sum(balance),0) FROM "PointAccount"),
  'ledgerTotal',(SELECT coalesce(sum(amount),0) FROM "PointLedger"),
  'rankingEntries',(SELECT count(*) FROM "RankingEntry"),
  'rankingAwards',(SELECT count(*) FROM "RankingAward"),
  'redemptions',(SELECT count(*) FROM "RedemptionOrder"),
  'accountBalanceMismatches',(SELECT count(*) FROM "PointAccount" a WHERE a.balance <>
    (SELECT coalesce(sum(l.amount),0) FROM "PointLedger" l WHERE l."accountId"=a.id))
);

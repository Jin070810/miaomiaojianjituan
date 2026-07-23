-- Additive reward snapshots for manual ranking settlement.
ALTER TABLE "RankingAward" ADD COLUMN "rewardTitle" TEXT;
ALTER TABLE "RankingAward" ADD COLUMN "rewardDescription" TEXT;

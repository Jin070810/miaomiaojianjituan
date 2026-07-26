-- Additive migration: existing single-target assignments remain readable through
-- the legacy rewardPoints field until an audited READY-period upgrade is run.
ALTER TABLE "WeeklyChallengePeriod"
  ADD COLUMN "rewardPolicyVersion" TEXT NOT NULL DEFAULT 'single-v1';

ALTER TABLE "WeeklyChallengeAssignment"
  ADD COLUMN "rewardTiers" JSONB,
  ADD COLUMN "claimedRewardPoints" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "claimedTier" INTEGER NOT NULL DEFAULT -1;

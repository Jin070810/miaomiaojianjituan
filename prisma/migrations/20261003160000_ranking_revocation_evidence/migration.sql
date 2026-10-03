-- Additive migration. Existing settled periods deliberately retain NULL
-- evidence markers; present-day video state cannot reconstruct their history.
ALTER TABLE "RankingPeriod"
  ADD COLUMN "ruleSnapshot" JSONB,
  ADD COLUMN "contributionsCapturedAt" TIMESTAMP(3);

CREATE TABLE "RankingContribution" (
  "periodId" TEXT NOT NULL,
  "videoId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "likes" INTEGER NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RankingContribution_pkey" PRIMARY KEY ("periodId", "videoId"),
  CONSTRAINT "RankingContribution_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "RankingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RankingContribution_videoId_periodId_idx" ON "RankingContribution"("videoId", "periodId");
CREATE INDEX "RankingContribution_periodId_userId_idx" ON "RankingContribution"("periodId", "userId");

CREATE TABLE "RankingAwardAdjustment" (
  "id" TEXT NOT NULL,
  "awardId" TEXT NOT NULL,
  "videoId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "source" TEXT NOT NULL,
  "videoSnapshot" JSONB NOT NULL,
  "awardSnapshot" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolution" TEXT,
  "resolutionNote" TEXT,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "RankingAwardAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RankingAwardAdjustment_awardId_fkey" FOREIGN KEY ("awardId") REFERENCES "RankingAward"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RankingAwardAdjustment_kind_check" CHECK ("kind" IN ('FREEZE_UNPAID', 'REVIEW_PAID')),
  CONSTRAINT "RankingAwardAdjustment_source_check" CHECK ("source" IN ('SNAPSHOT', 'LEGACY_WINDOW')),
  CONSTRAINT "RankingAwardAdjustment_resolution_check" CHECK (
    ("status" = 'PENDING' AND "resolution" IS NULL AND "resolvedById" IS NULL AND "resolvedAt" IS NULL AND "resolutionNote" IS NULL)
    OR ("status" = 'RESOLVED' AND "resolution" IN ('RELEASE', 'CANCEL', 'ADJUSTED', 'NO_CHANGE') AND "resolvedById" IS NOT NULL AND "resolvedAt" IS NOT NULL AND length(trim("resolutionNote")) >= 5)
  )
);
CREATE UNIQUE INDEX "RankingAwardAdjustment_awardId_videoId_key" ON "RankingAwardAdjustment"("awardId", "videoId");
CREATE INDEX "RankingAwardAdjustment_status_createdAt_idx" ON "RankingAwardAdjustment"("status", "createdAt");
CREATE INDEX "RankingAwardAdjustment_awardId_kind_status_idx" ON "RankingAwardAdjustment"("awardId", "kind", "status");

-- Old application versions do not know the new sidecar table. Retain the old
-- award enum but prevent a rollback/legacy writer from bypassing an open hold.
CREATE FUNCTION guard_ranking_award_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."giftId" IS DISTINCT FROM OLD."giftId"
      OR (NEW."status" IS DISTINCT FROM OLD."status" AND NEW."status" IN ('CLAIMED', 'FULFILLED')))
     AND EXISTS (SELECT 1 FROM "RankingAwardAdjustment" a WHERE a."awardId" = NEW."id" AND a."kind" = 'FREEZE_UNPAID' AND a."status" = 'PENDING') THEN
    RAISE EXCEPTION '榜单奖励已冻结，需先完成审计调整' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "RankingAward_hold_guard" BEFORE UPDATE ON "RankingAward"
FOR EACH ROW EXECUTE FUNCTION guard_ranking_award_hold();

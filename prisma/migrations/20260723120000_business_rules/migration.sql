-- Business rules: video eligibility metadata, reusable recipient data, and period rankings.
CREATE TYPE "GiftKind" AS ENUM ('PHYSICAL', 'CASH');
CREATE TYPE "RankingPeriodType" AS ENUM ('WEEK', 'MONTH');
CREATE TYPE "RankingPeriodStatus" AS ENUM ('OPEN', 'SETTLED');
CREATE TYPE "RankingAwardStatus" AS ENUM ('PENDING', 'CLAIMED', 'FULFILLED', 'EXPIRED');

DROP INDEX "VideoSubmission_photoId_key";

ALTER TABLE "Gift"
  ADD COLUMN "kind" "GiftKind" NOT NULL DEFAULT 'PHYSICAL';

ALTER TABLE "RedemptionOrder"
  ADD COLUMN "cashQrCodeUrl" TEXT,
  ADD COLUMN "recipientAddressEnc" TEXT,
  ADD COLUMN "recipientName" TEXT,
  ADD COLUMN "recipientPhoneEnc" TEXT;

ALTER TABLE "VideoSubmission"
  ADD COLUMN "publishedAt" TIMESTAMP(3);

CREATE TABLE "RecipientProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "recipientName" TEXT,
  "phoneEnc" TEXT,
  "addressEnc" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecipientProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RankingPeriod" (
  "id" TEXT NOT NULL,
  "type" "RankingPeriodType" NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "status" "RankingPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RankingPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RankingEntry" (
  "id" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "value" INTEGER NOT NULL,
  "videoCount" INTEGER NOT NULL DEFAULT 0,
  "likes" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RankingEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RankingAward" (
  "id" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "value" INTEGER NOT NULL,
  "giftId" TEXT,
  "status" "RankingAwardStatus" NOT NULL DEFAULT 'PENDING',
  "recipientName" TEXT,
  "recipientPhoneEnc" TEXT,
  "recipientAddressEnc" TEXT,
  "cashQrCodeUrl" TEXT,
  "claimedAt" TIMESTAMP(3),
  "fulfilledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RankingAward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecipientProfile_userId_key" ON "RecipientProfile"("userId");
CREATE UNIQUE INDEX "RankingPeriod_type_periodStart_key" ON "RankingPeriod"("type", "periodStart");
CREATE INDEX "RankingPeriod_type_status_periodStart_idx" ON "RankingPeriod"("type", "status", "periodStart");
CREATE UNIQUE INDEX "RankingEntry_periodId_userId_key" ON "RankingEntry"("periodId", "userId");
CREATE UNIQUE INDEX "RankingEntry_periodId_rank_key" ON "RankingEntry"("periodId", "rank");
CREATE INDEX "RankingEntry_periodId_rank_idx" ON "RankingEntry"("periodId", "rank");
CREATE UNIQUE INDEX "RankingAward_periodId_userId_key" ON "RankingAward"("periodId", "userId");
CREATE UNIQUE INDEX "RankingAward_periodId_rank_key" ON "RankingAward"("periodId", "rank");
CREATE INDEX "RankingAward_userId_status_idx" ON "RankingAward"("userId", "status");
CREATE INDEX "VideoSubmission_photoId_status_idx" ON "VideoSubmission"("photoId", "status");
CREATE UNIQUE INDEX "VideoSubmission_photoId_active_key"
  ON "VideoSubmission"("photoId")
  WHERE "photoId" IS NOT NULL AND "status" IN ('PROCESSING', 'PENDING_REVIEW', 'APPROVED');

ALTER TABLE "RecipientProfile"
  ADD CONSTRAINT "RecipientProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RankingEntry"
  ADD CONSTRAINT "RankingEntry_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "RankingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RankingEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RankingAward"
  ADD CONSTRAINT "RankingAward_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "RankingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RankingAward_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RankingAward_giftId_fkey"
  FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

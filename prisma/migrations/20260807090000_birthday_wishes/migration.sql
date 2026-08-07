ALTER TYPE "LedgerType" ADD VALUE 'BIRTHDAY_DRAW_REWARD';
ALTER TYPE "LedgerType" ADD VALUE 'BIRTHDAY_VIDEO_BONUS';
ALTER TYPE "NotificationType" ADD VALUE 'BIRTHDAY';

CREATE TYPE "BirthdayPrizeKind" AS ENUM ('POINTS', 'GIFT');
CREATE TYPE "BirthdayPrizeStatus" AS ENUM ('GRANTED', 'PENDING_CLAIM', 'CLAIMED', 'EXPIRED');

ALTER TABLE "VideoSubmission"
  ADD COLUMN "birthdayBenefitYear" INTEGER,
  ADD COLUMN "birthdayOccurrenceDate" TIMESTAMP(3),
  ADD COLUMN "birthdayBonusPoints" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "RedemptionOrder" ADD COLUMN "birthdayPrizeId" TEXT;

CREATE TABLE "MemberBirthdayProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "birthDateEnc" TEXT,
  "birthMonth" INTEGER,
  "birthDay" INTEGER,
  "pendingBirthDateEnc" TEXT,
  "pendingBirthMonth" INTEGER,
  "pendingBirthDay" INTEGER,
  "pendingEffectiveAt" TIMESTAMP(3),
  "visibleOnWall" BOOLEAN NOT NULL DEFAULT false,
  "visibilityConsentedAt" TIMESTAMP(3),
  "lastSelfChangeAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemberBirthdayProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MemberBirthdayProfile_month_check" CHECK ("birthMonth" IS NULL OR "birthMonth" BETWEEN 1 AND 12),
  CONSTRAINT "MemberBirthdayProfile_day_check" CHECK ("birthDay" IS NULL OR "birthDay" BETWEEN 1 AND 31),
  CONSTRAINT "MemberBirthdayProfile_pending_month_check" CHECK ("pendingBirthMonth" IS NULL OR "pendingBirthMonth" BETWEEN 1 AND 12),
  CONSTRAINT "MemberBirthdayProfile_pending_day_check" CHECK ("pendingBirthDay" IS NULL OR "pendingBirthDay" BETWEEN 1 AND 31)
);

CREATE TABLE "BirthdayAnnualBenefit" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "benefitYear" INTEGER NOT NULL,
  "occurrenceDate" TIMESTAMP(3) NOT NULL,
  "drawOpensAt" TIMESTAMP(3) NOT NULL,
  "drawClosesAt" TIMESTAMP(3) NOT NULL,
  "bonusGranted" INTEGER NOT NULL DEFAULT 0,
  "drawPolicyVersion" TEXT NOT NULL DEFAULT 'birthday-draw-v1',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BirthdayAnnualBenefit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BirthdayAnnualBenefit_bonus_check" CHECK ("bonusGranted" BETWEEN 0 AND 500)
);

CREATE TABLE "BirthdayPrizePoolItem" (
  "id" TEXT NOT NULL,
  "giftId" TEXT NOT NULL,
  "allocatedStock" INTEGER NOT NULL,
  "remainingStock" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BirthdayPrizePoolItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BirthdayPrizePoolItem_stock_check" CHECK ("allocatedStock" >= 0 AND "remainingStock" >= 0 AND "remainingStock" <= "allocatedStock")
);

CREATE TABLE "BirthdayPrize" (
  "id" TEXT NOT NULL,
  "annualBenefitId" TEXT NOT NULL,
  "kind" "BirthdayPrizeKind" NOT NULL,
  "points" INTEGER,
  "giftId" TEXT,
  "poolItemId" TEXT,
  "status" "BirthdayPrizeStatus" NOT NULL,
  "ticket" INTEGER NOT NULL,
  "fallback" BOOLEAN NOT NULL DEFAULT false,
  "claimExpiresAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "drawIdempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BirthdayPrize_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BirthdayPrize_ticket_check" CHECK ("ticket" BETWEEN 0 AND 99999),
  CONSTRAINT "BirthdayPrize_points_check" CHECK ("points" IS NULL OR "points" > 0)
);

CREATE TABLE "BirthdayWish" (
  "id" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "benefitYear" INTEGER NOT NULL,
  "presetCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BirthdayWish_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BirthdayWish_not_self_check" CHECK ("senderId" <> "recipientId")
);

CREATE UNIQUE INDEX "MemberBirthdayProfile_userId_key" ON "MemberBirthdayProfile"("userId");
CREATE INDEX "MemberBirthdayProfile_visibleOnWall_birthMonth_birthDay_idx" ON "MemberBirthdayProfile"("visibleOnWall", "birthMonth", "birthDay");
CREATE INDEX "MemberBirthdayProfile_pendingEffectiveAt_idx" ON "MemberBirthdayProfile"("pendingEffectiveAt");
CREATE UNIQUE INDEX "BirthdayAnnualBenefit_userId_benefitYear_key" ON "BirthdayAnnualBenefit"("userId", "benefitYear");
CREATE INDEX "BirthdayAnnualBenefit_occurrenceDate_idx" ON "BirthdayAnnualBenefit"("occurrenceDate");
CREATE UNIQUE INDEX "BirthdayPrizePoolItem_giftId_key" ON "BirthdayPrizePoolItem"("giftId");
CREATE INDEX "BirthdayPrizePoolItem_active_remainingStock_idx" ON "BirthdayPrizePoolItem"("active", "remainingStock");
CREATE UNIQUE INDEX "BirthdayPrize_annualBenefitId_key" ON "BirthdayPrize"("annualBenefitId");
CREATE UNIQUE INDEX "BirthdayPrize_drawIdempotencyKey_key" ON "BirthdayPrize"("drawIdempotencyKey");
CREATE INDEX "BirthdayPrize_status_claimExpiresAt_idx" ON "BirthdayPrize"("status", "claimExpiresAt");
CREATE UNIQUE INDEX "BirthdayWish_senderId_recipientId_benefitYear_key" ON "BirthdayWish"("senderId", "recipientId", "benefitYear");
CREATE INDEX "BirthdayWish_recipientId_benefitYear_createdAt_idx" ON "BirthdayWish"("recipientId", "benefitYear", "createdAt");
CREATE UNIQUE INDEX "RedemptionOrder_birthdayPrizeId_key" ON "RedemptionOrder"("birthdayPrizeId");
CREATE INDEX "VideoSubmission_userId_birthdayBenefitYear_idx" ON "VideoSubmission"("userId", "birthdayBenefitYear");

ALTER TABLE "MemberBirthdayProfile" ADD CONSTRAINT "MemberBirthdayProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BirthdayAnnualBenefit" ADD CONSTRAINT "BirthdayAnnualBenefit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BirthdayPrizePoolItem" ADD CONSTRAINT "BirthdayPrizePoolItem_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BirthdayPrize" ADD CONSTRAINT "BirthdayPrize_annualBenefitId_fkey" FOREIGN KEY ("annualBenefitId") REFERENCES "BirthdayAnnualBenefit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BirthdayPrize" ADD CONSTRAINT "BirthdayPrize_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BirthdayPrize" ADD CONSTRAINT "BirthdayPrize_poolItemId_fkey" FOREIGN KEY ("poolItemId") REFERENCES "BirthdayPrizePoolItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BirthdayWish" ADD CONSTRAINT "BirthdayWish_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BirthdayWish" ADD CONSTRAINT "BirthdayWish_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RedemptionOrder" ADD CONSTRAINT "RedemptionOrder_birthdayPrizeId_fkey" FOREIGN KEY ("birthdayPrizeId") REFERENCES "BirthdayPrize"("id") ON DELETE SET NULL ON UPDATE CASCADE;

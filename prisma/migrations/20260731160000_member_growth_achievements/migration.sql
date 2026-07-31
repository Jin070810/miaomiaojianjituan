-- Member growth, achievements, monthly goals and richer public video metadata.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACHIEVEMENT';

ALTER TABLE "VideoSubmission"
  ADD COLUMN "commentCount" INTEGER,
  ADD COLUMN "caption" TEXT,
  ADD COLUMN "coverUrl" TEXT,
  ADD COLUMN "metadataFetchedAt" TIMESTAMP(3);

CREATE TABLE "MemberGrowthProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "experience" INTEGER NOT NULL DEFAULT 0,
  "level" INTEGER NOT NULL DEFAULT 1,
  "scoreVersion" TEXT NOT NULL DEFAULT 'v1',
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemberGrowthProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemberAchievement" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberAchievement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemberMonthlyGoal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "monthStart" TIMESTAMP(3) NOT NULL,
  "baselineVideos" INTEGER NOT NULL,
  "baselineEngagement" INTEGER NOT NULL,
  "targetVideos" INTEGER NOT NULL,
  "targetEngagement" INTEGER NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemberMonthlyGoal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemberMonthlyReview" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "monthStart" TIMESTAMP(3) NOT NULL,
  "approvedVideos" INTEGER NOT NULL,
  "engagement" INTEGER NOT NULL,
  "goalCompleted" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberMonthlyReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MemberGrowthProfile_userId_key" ON "MemberGrowthProfile"("userId");
CREATE UNIQUE INDEX "MemberAchievement_userId_code_key" ON "MemberAchievement"("userId", "code");
CREATE INDEX "MemberAchievement_userId_earnedAt_idx" ON "MemberAchievement"("userId", "earnedAt");
CREATE UNIQUE INDEX "MemberMonthlyGoal_userId_monthStart_key" ON "MemberMonthlyGoal"("userId", "monthStart");
CREATE INDEX "MemberMonthlyGoal_userId_monthStart_idx" ON "MemberMonthlyGoal"("userId", "monthStart");
CREATE UNIQUE INDEX "MemberMonthlyReview_userId_monthStart_key" ON "MemberMonthlyReview"("userId", "monthStart");
CREATE INDEX "MemberMonthlyReview_userId_monthStart_idx" ON "MemberMonthlyReview"("userId", "monthStart");

ALTER TABLE "MemberGrowthProfile" ADD CONSTRAINT "MemberGrowthProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberAchievement" ADD CONSTRAINT "MemberAchievement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberMonthlyGoal" ADD CONSTRAINT "MemberMonthlyGoal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberMonthlyReview" ADD CONSTRAINT "MemberMonthlyReview_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

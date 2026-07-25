-- CreateEnum
CREATE TYPE "WeeklyChallengePeriodStatus" AS ENUM ('GENERATING', 'READY', 'ACTIVE', 'CLOSED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WeeklyChallengeType" AS ENUM ('VIDEO_COUNT', 'LIKE_SUM', 'COMBINED');

-- CreateEnum
CREATE TYPE "WeeklyChallengeAssignmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CLAIMED', 'REVERSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WeeklyChallengeAttemptStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterEnum
ALTER TYPE "LedgerType" ADD VALUE 'WEEKLY_CHALLENGE_REWARD';
ALTER TYPE "LedgerType" ADD VALUE 'WEEKLY_RACE_REWARD';
ALTER TYPE "LedgerType" ADD VALUE 'WEEKLY_CHALLENGE_REVERSAL';
ALTER TYPE "LedgerType" ADD VALUE 'WEEKLY_RACE_REVERSAL';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'WEEKLY_CHALLENGE';

-- CreateTable
CREATE TABLE "WeeklyChallengePeriod" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "claimEndsAt" TIMESTAMP(3) NOT NULL,
    "status" "WeeklyChallengePeriodStatus" NOT NULL DEFAULT 'GENERATING',
    "personalRewardBudget" INTEGER NOT NULL DEFAULT 10000,
    "raceReward" INTEGER NOT NULL DEFAULT 2000,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL DEFAULT 'v1',
    "audienceSnapshot" JSONB NOT NULL,
    "audienceCount" INTEGER NOT NULL,
    "generationRunId" TEXT,
    "generationStartedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyChallengePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyChallengeAssignment" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "WeeklyChallengeType" NOT NULL,
    "status" "WeeklyChallengeAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "baselineVideoCount" INTEGER NOT NULL DEFAULT 0,
    "baselineLikes" INTEGER NOT NULL DEFAULT 0,
    "weeklyVideoCounts" JSONB NOT NULL,
    "weeklyLikeSums" JSONB NOT NULL,
    "targetVideoCount" INTEGER,
    "targetLikes" INTEGER,
    "rewardPoints" INTEGER NOT NULL,
    "difficultyScore" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "aiReason" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "claimIdempotencyKey" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyChallengeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyChallengeGenerationAttempt" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "batchNumber" INTEGER NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "WeeklyChallengeAttemptStatus" NOT NULL DEFAULT 'RUNNING',
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "error" TEXT,
    "validatedOutput" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyChallengeGenerationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyRaceWinner" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rewardPoints" INTEGER NOT NULL,
    "wonAt" TIMESTAMP(3) NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyRaceWinner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyChallengePeriod_periodStart_key" ON "WeeklyChallengePeriod"("periodStart");
CREATE INDEX "WeeklyChallengePeriod_status_periodStart_idx" ON "WeeklyChallengePeriod"("status", "periodStart");
CREATE UNIQUE INDEX "WeeklyChallengeAssignment_periodId_userId_key" ON "WeeklyChallengeAssignment"("periodId", "userId");
CREATE UNIQUE INDEX "WeeklyChallengeAssignment_claimIdempotencyKey_key" ON "WeeklyChallengeAssignment"("claimIdempotencyKey");
CREATE INDEX "WeeklyChallengeAssignment_userId_status_createdAt_idx" ON "WeeklyChallengeAssignment"("userId", "status", "createdAt");
CREATE INDEX "WeeklyChallengeAssignment_periodId_status_completedAt_idx" ON "WeeklyChallengeAssignment"("periodId", "status", "completedAt");
CREATE UNIQUE INDEX "WeeklyChallengeGenerationAttempt_periodId_batchNumber_attemptNumber_key" ON "WeeklyChallengeGenerationAttempt"("periodId", "batchNumber", "attemptNumber");
CREATE INDEX "WeeklyChallengeGenerationAttempt_periodId_status_createdAt_idx" ON "WeeklyChallengeGenerationAttempt"("periodId", "status", "createdAt");
CREATE UNIQUE INDEX "WeeklyRaceWinner_periodId_key" ON "WeeklyRaceWinner"("periodId");
CREATE UNIQUE INDEX "WeeklyRaceWinner_assignmentId_key" ON "WeeklyRaceWinner"("assignmentId");
CREATE INDEX "WeeklyRaceWinner_userId_wonAt_idx" ON "WeeklyRaceWinner"("userId", "wonAt");

-- AddForeignKey
ALTER TABLE "WeeklyChallengeAssignment" ADD CONSTRAINT "WeeklyChallengeAssignment_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "WeeklyChallengePeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeeklyChallengeAssignment" ADD CONSTRAINT "WeeklyChallengeAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeeklyChallengeGenerationAttempt" ADD CONSTRAINT "WeeklyChallengeGenerationAttempt_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "WeeklyChallengePeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeeklyRaceWinner" ADD CONSTRAINT "WeeklyRaceWinner_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "WeeklyChallengePeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeeklyRaceWinner" ADD CONSTRAINT "WeeklyRaceWinner_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "WeeklyChallengeAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeeklyRaceWinner" ADD CONSTRAINT "WeeklyRaceWinner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

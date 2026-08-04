-- CreateEnum
CREATE TYPE "WeeklyChallengeGenerationSource" AS ENUM ('AI', 'DETERMINISTIC');

-- CreateEnum
CREATE TYPE "WeeklyChallengeGenerationMode" AS ENUM ('AI', 'HYBRID', 'DETERMINISTIC');

-- AlterTable
ALTER TABLE "WeeklyChallengePeriod"
ADD COLUMN "generationMode" "WeeklyChallengeGenerationMode" NOT NULL DEFAULT 'AI',
ADD COLUMN "fallbackBatchCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "generationWarning" TEXT;

-- AlterTable
ALTER TABLE "WeeklyChallengeGenerationAttempt"
ADD COLUMN "source" "WeeklyChallengeGenerationSource" NOT NULL DEFAULT 'AI',
ADD COLUMN "generationRunId" TEXT,
ADD COLUMN "inputHash" TEXT;

-- CreateIndex
CREATE INDEX "WeeklyChallengeGenerationAttempt_periodId_batchNumber_inputHash_status_idx"
ON "WeeklyChallengeGenerationAttempt"("periodId", "batchNumber", "inputHash", "status");

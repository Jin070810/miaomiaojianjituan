-- Additive: existing submissions acquire a budget on their next processing attempt.
CREATE TABLE "VideoProcessingState" (
  "videoId" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastFailure" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VideoProcessingState_pkey" PRIMARY KEY ("videoId"),
  CONSTRAINT "VideoProcessingState_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= 3),
  CONSTRAINT "VideoProcessingState_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "VideoSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "VideoProcessingState_nextAttemptAt_idx" ON "VideoProcessingState"("nextAttemptAt");

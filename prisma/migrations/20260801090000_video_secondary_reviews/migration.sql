CREATE TYPE "VideoSecondaryReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "VideoSecondaryReview" (
  "id" TEXT NOT NULL,
  "videoId" TEXT NOT NULL,
  "reviewerId" TEXT,
  "status" "VideoSecondaryReviewStatus" NOT NULL DEFAULT 'PENDING',
  "reviewReason" TEXT,
  "assignedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VideoSecondaryReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VideoSecondaryReview_videoId_key" ON "VideoSecondaryReview"("videoId");
CREATE INDEX "VideoSecondaryReview_status_createdAt_idx" ON "VideoSecondaryReview"("status", "createdAt");
CREATE INDEX "VideoSecondaryReview_reviewerId_status_createdAt_idx" ON "VideoSecondaryReview"("reviewerId", "status", "createdAt");

ALTER TABLE "VideoSecondaryReview"
  ADD CONSTRAINT "VideoSecondaryReview_videoId_fkey"
  FOREIGN KEY ("videoId") REFERENCES "VideoSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VideoSecondaryReview"
  ADD CONSTRAINT "VideoSecondaryReview_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Context captured with a sealed monthly growth review.
ALTER TABLE "MemberMonthlyReview"
  ADD COLUMN "baselineVideos" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "baselineEngagement" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "previousVideos" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "previousEngagement" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "highlightVideoId" TEXT;

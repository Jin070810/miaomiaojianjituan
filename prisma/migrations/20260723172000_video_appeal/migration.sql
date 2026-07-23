-- CreateEnum
CREATE TYPE "VideoAppealStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "VideoAppeal" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "VideoAppealStatus" NOT NULL DEFAULT 'PENDING',
    "reviewReason" TEXT,
    "reviewedPoints" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    CONSTRAINT "VideoAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoAppeal_idempotencyKey_key" ON "VideoAppeal"("idempotencyKey");
CREATE INDEX "VideoAppeal_status_createdAt_idx" ON "VideoAppeal"("status", "createdAt");
CREATE INDEX "VideoAppeal_videoId_createdAt_idx" ON "VideoAppeal"("videoId", "createdAt");
CREATE INDEX "VideoAppeal_userId_createdAt_idx" ON "VideoAppeal"("userId", "createdAt");
CREATE UNIQUE INDEX "VideoAppeal_pending_video_key" ON "VideoAppeal"("videoId") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "VideoAppeal" ADD CONSTRAINT "VideoAppeal_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "VideoSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoAppeal" ADD CONSTRAINT "VideoAppeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoAppeal" ADD CONSTRAINT "VideoAppeal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

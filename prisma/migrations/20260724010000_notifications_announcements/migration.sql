CREATE TYPE "NotificationType" AS ENUM (
  'ANNOUNCEMENT',
  'VIDEO_RESULT',
  'APPEAL_RESULT',
  'POINTS',
  'TRANSFER',
  'REDEMPTION',
  'RANKING_RESULT',
  'RANKING_AWARD'
);

CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'WITHDRAWN');
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL', 'SELECTED');

CREATE TABLE "Announcement" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
  "audience" "AnnouncementAudience" NOT NULL,
  "createdById" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "withdrawnAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnnouncementRecipient" (
  "announcementId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnouncementRecipient_pkey" PRIMARY KEY ("announcementId", "userId")
);

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "metadata" JSONB,
  "readAt" TIMESTAMP(3),
  "dedupeKey" TEXT NOT NULL,
  "announcementId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Announcement_status_createdAt_idx" ON "Announcement"("status", "createdAt");
CREATE INDEX "Announcement_createdById_createdAt_idx" ON "Announcement"("createdById", "createdAt");
CREATE INDEX "AnnouncementRecipient_userId_createdAt_idx" ON "AnnouncementRecipient"("userId", "createdAt");
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_announcementId_idx" ON "Notification"("announcementId");

ALTER TABLE "Announcement"
  ADD CONSTRAINT "Announcement_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AnnouncementRecipient"
  ADD CONSTRAINT "AnnouncementRecipient_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AnnouncementRecipient_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Notification_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

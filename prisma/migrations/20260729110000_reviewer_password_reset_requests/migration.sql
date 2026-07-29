ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'REVIEWER';

CREATE TYPE "PasswordResetRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

CREATE TABLE "PasswordResetRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "proposedPasswordHash" TEXT NOT NULL,
    "status" "PasswordResetRequestStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordResetRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PasswordResetRequest_status_expiresAt_idx" ON "PasswordResetRequest"("status", "expiresAt");
CREATE INDEX "PasswordResetRequest_userId_status_idx" ON "PasswordResetRequest"("userId", "status");
CREATE UNIQUE INDEX "PasswordResetRequest_one_pending_per_user" ON "PasswordResetRequest"("userId") WHERE "status" = 'PENDING';

ALTER TABLE "PasswordResetRequest" ADD CONSTRAINT "PasswordResetRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetRequest" ADD CONSTRAINT "PasswordResetRequest_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

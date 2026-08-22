CREATE TYPE "RegistrationApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "RegistrationInviteLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationInviteLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RegistrationApplication" (
    "id" TEXT NOT NULL,
    "inviteLinkId" TEXT NOT NULL,
    "kuaishouId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "guildStatus" TEXT,
    "boundPhoneEnc" TEXT,
    "proposedPasswordHash" TEXT,
    "queryTokenHash" TEXT NOT NULL,
    "status" "RegistrationApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "approvedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RegistrationInviteLink_tokenHash_key" ON "RegistrationInviteLink"("tokenHash");
CREATE UNIQUE INDEX "RegistrationInviteLink_one_active_key" ON "RegistrationInviteLink"("active") WHERE "active" = true;
CREATE INDEX "RegistrationInviteLink_active_expiresAt_idx" ON "RegistrationInviteLink"("active", "expiresAt");
CREATE UNIQUE INDEX "RegistrationApplication_queryTokenHash_key" ON "RegistrationApplication"("queryTokenHash");
CREATE UNIQUE INDEX "RegistrationApplication_one_pending_kuaishouId_key" ON "RegistrationApplication"(LOWER("kuaishouId")) WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "RegistrationApplication_approvedUserId_key" ON "RegistrationApplication"("approvedUserId");
CREATE INDEX "RegistrationApplication_status_createdAt_idx" ON "RegistrationApplication"("status", "createdAt");
CREATE INDEX "RegistrationApplication_kuaishouId_status_idx" ON "RegistrationApplication"("kuaishouId", "status");

ALTER TABLE "RegistrationInviteLink" ADD CONSTRAINT "RegistrationInviteLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RegistrationApplication" ADD CONSTRAINT "RegistrationApplication_inviteLinkId_fkey" FOREIGN KEY ("inviteLinkId") REFERENCES "RegistrationInviteLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RegistrationApplication" ADD CONSTRAINT "RegistrationApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RegistrationApplication" ADD CONSTRAINT "RegistrationApplication_approvedUserId_fkey" FOREIGN KEY ("approvedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

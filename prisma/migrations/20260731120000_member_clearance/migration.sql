-- Member clearance is append-only: history, points and fulfilled orders remain intact.
ALTER TYPE "LedgerType" ADD VALUE 'MEMBER_CLEARANCE_FORFEIT';
ALTER TYPE "RedemptionStatus" ADD VALUE 'CLEARANCE_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE 'MEMBER_CLEARANCE';

CREATE TYPE "MemberEligibilityStatus" AS ENUM ('ACTIVE', 'COOLDOWN', 'REJOIN_PENDING', 'REJOIN_REJECTED', 'EXEMPT');
CREATE TYPE "RejoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "MemberClearanceProgram" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "firstEnabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemberClearanceProgram_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MembershipClearancePolicyVersion" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "inactivityDays" INTEGER NOT NULL,
  "warningDays" INTEGER[] NOT NULL,
  "cooldownDays" INTEGER NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MembershipClearancePolicyVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemberEligibility" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "policyVersionId" TEXT NOT NULL,
  "status" "MemberEligibilityStatus" NOT NULL DEFAULT 'ACTIVE',
  "cycleStartedAt" TIMESTAMP(3) NOT NULL,
  "lastOutputAt" TIMESTAMP(3),
  "warning14SentAt" TIMESTAMP(3),
  "warning3SentAt" TIMESTAMP(3),
  "clearedAt" TIMESTAMP(3),
  "cooldownEndsAt" TIMESTAMP(3),
  "rejoinRetryAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemberEligibility_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RejoinRequest" (
  "id" TEXT NOT NULL,
  "eligibilityId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "RejoinRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "reviewReason" TEXT,
  CONSTRAINT "RejoinRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MembershipClearancePolicyVersion_version_key" ON "MembershipClearancePolicyVersion"("version");
CREATE INDEX "MembershipClearancePolicyVersion_createdAt_idx" ON "MembershipClearancePolicyVersion"("createdAt");
CREATE UNIQUE INDEX "MemberEligibility_userId_key" ON "MemberEligibility"("userId");
CREATE INDEX "MemberEligibility_status_cooldownEndsAt_idx" ON "MemberEligibility"("status", "cooldownEndsAt");
CREATE INDEX "MemberEligibility_status_cycleStartedAt_idx" ON "MemberEligibility"("status", "cycleStartedAt");
CREATE INDEX "RejoinRequest_status_requestedAt_idx" ON "RejoinRequest"("status", "requestedAt");
CREATE INDEX "RejoinRequest_userId_requestedAt_idx" ON "RejoinRequest"("userId", "requestedAt");

ALTER TABLE "MembershipClearancePolicyVersion" ADD CONSTRAINT "MembershipClearancePolicyVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MemberEligibility" ADD CONSTRAINT "MemberEligibility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberEligibility" ADD CONSTRAINT "MemberEligibility_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "MembershipClearancePolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RejoinRequest" ADD CONSTRAINT "RejoinRequest_eligibilityId_fkey" FOREIGN KEY ("eligibilityId") REFERENCES "MemberEligibility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RejoinRequest" ADD CONSTRAINT "RejoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RejoinRequest" ADD CONSTRAINT "RejoinRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

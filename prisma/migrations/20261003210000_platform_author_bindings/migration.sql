ALTER TABLE "VideoSubmission"
  ADD COLUMN "fetchedAuthorUid" TEXT,
  ADD COLUMN "authorEvidenceVersion" INTEGER,
  ADD COLUMN "verifiedBindingId" TEXT;

CREATE TABLE "PlatformBindingRequest" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "platform" TEXT NOT NULL CHECK ("platform" IN ('kuaishou', 'douyin')),
  "authorUid" TEXT NOT NULL CHECK ("authorUid" ~ '^[A-Za-z0-9_-]{1,128}$'),
  "videoId" TEXT NOT NULL,
  "photoId" TEXT NOT NULL,
  "challenge" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED')),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "proofMethod" TEXT CHECK ("proofMethod" IN ('PLATFORM_MESSAGE', 'PROFILE_CHALLENGE')),
  "proofNote" TEXT,
  "rejectionReason" TEXT,
  CHECK ("status" <> 'APPROVED' OR ("reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL AND "proofMethod" IS NOT NULL AND "proofNote" IS NOT NULL AND length("proofNote") >= 20))
);
CREATE UNIQUE INDEX "PlatformBindingRequest_challenge_key" ON "PlatformBindingRequest"("challenge");
CREATE INDEX "PlatformBindingRequest_status_createdAt_idx" ON "PlatformBindingRequest"("status", "createdAt");
CREATE INDEX "PlatformBindingRequest_userId_platform_createdAt_idx" ON "PlatformBindingRequest"("userId", "platform", "createdAt");
CREATE UNIQUE INDEX "PlatformBindingRequest_pending_user_platform" ON "PlatformBindingRequest"("userId", "platform") WHERE "status" = 'PENDING';

CREATE TABLE "PlatformAccountBinding" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "platform" TEXT NOT NULL CHECK ("platform" IN ('kuaishou', 'douyin')),
  "authorUid" TEXT NOT NULL CHECK ("authorUid" ~ '^[A-Za-z0-9_-]{1,128}$'),
  "requestId" TEXT NOT NULL REFERENCES "PlatformBindingRequest"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED,
  "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedById" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "PlatformAccountBinding_requestId_key" ON "PlatformAccountBinding"("requestId");
CREATE UNIQUE INDEX "PlatformAccountBinding_platform_authorUid_key" ON "PlatformAccountBinding"("platform", "authorUid");
CREATE INDEX "PlatformAccountBinding_userId_platform_idx" ON "PlatformAccountBinding"("userId", "platform");
CREATE UNIQUE INDEX "PlatformAccountBinding_active_user_platform" ON "PlatformAccountBinding"("userId", "platform") WHERE "revokedAt" IS NULL;

-- UID ownership history cannot silently move to another member, even after revocation.
CREATE FUNCTION protect_platform_binding_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."platform" IS DISTINCT FROM OLD."platform" OR NEW."authorUid" IS DISTINCT FROM OLD."authorUid" THEN
    RAISE EXCEPTION 'Platform binding identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PlatformAccountBinding_identity_immutable" BEFORE UPDATE ON "PlatformAccountBinding"
  FOR EACH ROW EXECUTE FUNCTION protect_platform_binding_identity();

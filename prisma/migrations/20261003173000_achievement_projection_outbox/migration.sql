CREATE TABLE "MemberAchievementRefresh" (
  "userId" TEXT NOT NULL PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "generation" BIGINT NOT NULL DEFAULT 1,
  "appliedGeneration" BIGINT NOT NULL DEFAULT 0,
  "pending" BOOLEAN NOT NULL DEFAULT TRUE,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "failures" INTEGER NOT NULL DEFAULT 0,
  "lastFailureCode" TEXT,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "MemberAchievementRefresh_generation_check" CHECK (
    "generation" > 0 AND "appliedGeneration" >= 0 AND "appliedGeneration" <= "generation"
    AND "pending" = ("appliedGeneration" < "generation") AND "failures" >= 0
  ),
  CONSTRAINT "MemberAchievementRefresh_lease_check" CHECK (("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL))
);
CREATE INDEX "MemberAchievementRefresh_pending_availableAt_requestedAt_idx"
  ON "MemberAchievementRefresh"("pending", "availableAt", "requestedAt");

ALTER TABLE "MemberMonthlyGoal"
  ADD COLUMN "progressVideos" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "progressEngagement" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "calculatedAt" TIMESTAMP(3),
  ADD CONSTRAINT "MemberMonthlyGoal_progress_check" CHECK ("progressVideos" >= 0 AND "progressEngagement" >= 0);

CREATE INDEX "VideoSubmission_achievement_highlights_idx"
  ON "VideoSubmission"("userId", "status", "likes" DESC, "views" DESC, "submittedAt" DESC);

-- Keep source changes and durable refresh intent in the same database commit,
-- including imports, maintenance and older application versions during rollout.
CREATE FUNCTION request_member_achievement_refresh(member_id TEXT) RETURNS VOID AS $$
BEGIN
  INSERT INTO "MemberAchievementRefresh" ("userId", "requestedAt", "availableAt")
    SELECT "id", (clock_timestamp() AT TIME ZONE 'UTC'), (clock_timestamp() AT TIME ZONE 'UTC')
    FROM "User" WHERE "id" = member_id
  ON CONFLICT ("userId") DO UPDATE SET
    "generation" = "MemberAchievementRefresh"."generation" + 1,
    "pending" = TRUE,
    "requestedAt" = (clock_timestamp() AT TIME ZONE 'UTC'),
    "availableAt" = (clock_timestamp() AT TIME ZONE 'UTC'),
    "failures" = 0, "lastFailureCode" = NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION enqueue_new_member_achievement_refresh() RETURNS TRIGGER AS $$
BEGIN
  PERFORM request_member_achievement_refresh(NEW."id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER user_achievement_refresh AFTER INSERT ON "User"
  FOR EACH ROW EXECUTE FUNCTION enqueue_new_member_achievement_refresh();

CREATE FUNCTION enqueue_video_achievement_refresh() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
    ROW(OLD."userId", OLD."status", OLD."likes", OLD."views", OLD."commentCount", OLD."submittedAt")
    IS NOT DISTINCT FROM ROW(NEW."userId", NEW."status", NEW."likes", NEW."views", NEW."commentCount", NEW."submittedAt")
  THEN RETURN NULL; END IF;
  IF TG_OP <> 'INSERT' AND OLD."status" = 'APPROVED' THEN
    PERFORM request_member_achievement_refresh(OLD."userId");
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."status" = 'APPROVED' THEN
    IF TG_OP = 'INSERT' OR OLD."status" <> 'APPROVED' OR OLD."userId" IS DISTINCT FROM NEW."userId" THEN
      PERFORM request_member_achievement_refresh(NEW."userId");
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER video_achievement_refresh AFTER INSERT OR UPDATE OR DELETE ON "VideoSubmission"
  FOR EACH ROW EXECUTE FUNCTION enqueue_video_achievement_refresh();

CREATE FUNCTION enqueue_challenge_achievement_refresh() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."userId" = NEW."userId"
    AND (OLD."status" IN ('COMPLETED', 'CLAIMED')) = (NEW."status" IN ('COMPLETED', 'CLAIMED'))
  THEN RETURN NULL; END IF;
  IF TG_OP <> 'INSERT' AND OLD."status" IN ('COMPLETED', 'CLAIMED') THEN
    PERFORM request_member_achievement_refresh(OLD."userId");
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."status" IN ('COMPLETED', 'CLAIMED') THEN
    IF TG_OP = 'INSERT' OR OLD."status" NOT IN ('COMPLETED', 'CLAIMED') OR OLD."userId" IS DISTINCT FROM NEW."userId" THEN
      PERFORM request_member_achievement_refresh(NEW."userId");
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER challenge_achievement_refresh AFTER INSERT OR UPDATE OR DELETE ON "WeeklyChallengeAssignment"
  FOR EACH ROW EXECUTE FUNCTION enqueue_challenge_achievement_refresh();

-- Preserve historical profiles, medals and goals; the Worker rebuilds them from
-- source records after rollout. GET endpoints never create missing state.
INSERT INTO "MemberAchievementRefresh" ("userId", "requestedAt", "availableAt")
  SELECT "id", (clock_timestamp() AT TIME ZONE 'UTC'), (clock_timestamp() AT TIME ZONE 'UTC') FROM "User";

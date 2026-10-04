-- Keep the oldest unresolved request visible to backlog alerts. Later changes
-- may wake a failed task, but cannot repeatedly postpone a busy member's work.
CREATE OR REPLACE FUNCTION request_member_achievement_refresh(member_id TEXT) RETURNS VOID AS $$
BEGIN
  INSERT INTO "MemberAchievementRefresh" ("userId", "requestedAt", "availableAt")
    SELECT "id", (clock_timestamp() AT TIME ZONE 'UTC'), (clock_timestamp() AT TIME ZONE 'UTC')
    FROM "User" WHERE "id" = member_id
  ON CONFLICT ("userId") DO UPDATE SET
    "generation" = "MemberAchievementRefresh"."generation" + 1,
    "pending" = TRUE,
    "requestedAt" = CASE WHEN "MemberAchievementRefresh"."pending"
      THEN "MemberAchievementRefresh"."requestedAt" ELSE (clock_timestamp() AT TIME ZONE 'UTC') END,
    "availableAt" = CASE WHEN "MemberAchievementRefresh"."pending"
      THEN LEAST("MemberAchievementRefresh"."availableAt", (clock_timestamp() AT TIME ZONE 'UTC'))
      ELSE (clock_timestamp() AT TIME ZONE 'UTC') END,
    "failures" = 0, "lastFailureCode" = NULL;
END;
$$ LANGUAGE plpgsql;

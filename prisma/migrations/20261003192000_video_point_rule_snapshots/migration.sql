-- No historical score or video row is rewritten. Legacy approved rules remain unknown.
CREATE TABLE "VideoPointRuleSnapshot" (
    "videoId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "minimumLikes" INTEGER NOT NULL,
    "fixedTierMaxLikes" INTEGER NOT NULL,
    "fixedTierPoints" INTEGER NOT NULL,
    "likesDivisor" INTEGER NOT NULL,
    "maximumPoints" INTEGER NOT NULL,
    "submissionWindowDays" INTEGER NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoPointRuleSnapshot_pkey" PRIMARY KEY ("videoId"),
    CONSTRAINT "VideoPointRuleSnapshot_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "VideoSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VideoPointRuleSnapshot_format" CHECK (
        "revision" ~ '^[0-9a-f]{64}$' AND "formulaVersion" = 'likes-v1'
        AND "origin" IN ('FIRST_AUTOMATIC_REVIEW', 'LEGACY_APPEAL')
    ),
    CONSTRAINT "VideoPointRuleSnapshot_bounds" CHECK (
        "minimumLikes" BETWEEN 1 AND 1000000
        AND "fixedTierMaxLikes" BETWEEN "minimumLikes" AND 10000000
        AND "fixedTierPoints" BETWEEN 1 AND 1000000
        AND "likesDivisor" BETWEEN 1 AND 10000
        AND "maximumPoints" BETWEEN "fixedTierPoints" AND 10000000
        AND "submissionWindowDays" BETWEEN 1 AND 30
    )
);

CREATE FUNCTION protect_video_point_rule_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION 'Video point rule snapshot is immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    -- Cascading removal of a deleted video/user is allowed; erasing a live video's evidence is not.
    IF EXISTS (SELECT 1 FROM "VideoSubmission" WHERE "id" = OLD."videoId") THEN
        RAISE EXCEPTION 'Cannot remove the rule snapshot of a live video' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER "VideoPointRuleSnapshot_immutable"
BEFORE UPDATE OR DELETE ON "VideoPointRuleSnapshot"
FOR EACH ROW EXECUTE FUNCTION protect_video_point_rule_snapshot();

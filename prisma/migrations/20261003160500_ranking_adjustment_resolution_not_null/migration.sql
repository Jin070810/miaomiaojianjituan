-- PostgreSQL CHECK accepts UNKNOWN: explicitly reject missing resolution fields.
ALTER TABLE "RankingAwardAdjustment" ADD CONSTRAINT "RankingAwardAdjustment_closed_fields_check"
CHECK ("status" <> 'RESOLVED' OR ("resolution" IS NOT NULL AND "resolutionNote" IS NOT NULL));

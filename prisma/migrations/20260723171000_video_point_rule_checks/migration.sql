ALTER TABLE "VideoPointRule"
  ADD CONSTRAINT "VideoPointRule_minimumLikes_check"
    CHECK ("minimumLikes" > 0),
  ADD CONSTRAINT "VideoPointRule_fixedTier_check"
    CHECK ("fixedTierMaxLikes" >= "minimumLikes" AND "fixedTierPoints" > 0),
  ADD CONSTRAINT "VideoPointRule_formula_check"
    CHECK ("likesDivisor" > 0 AND "maximumPoints" >= "fixedTierPoints"),
  ADD CONSTRAINT "VideoPointRule_submissionWindowDays_check"
    CHECK ("submissionWindowDays" BETWEEN 1 AND 30);

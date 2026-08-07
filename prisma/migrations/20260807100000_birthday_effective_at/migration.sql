ALTER TABLE "MemberBirthdayProfile" ADD COLUMN "birthEffectiveAt" TIMESTAMP(3);

CREATE INDEX "MemberBirthdayProfile_birthEffectiveAt_idx" ON "MemberBirthdayProfile"("birthEffectiveAt");

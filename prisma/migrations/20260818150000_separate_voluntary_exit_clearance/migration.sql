-- clearedAt belongs exclusively to automatic inactivity clearance history.
-- Repair voluntary exits that were never automatically cleared; audit history remains intact.
UPDATE "MemberEligibility" AS eligibility
SET "clearedAt" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE eligibility."status" = 'EXEMPT'
  AND eligibility."clearedAt" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "AuditLog" AS voluntary_exit
    WHERE voluntary_exit."action" = 'MEMBER_VOLUNTARILY_LEFT'
      AND voluntary_exit."entityId" = eligibility."userId"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "AuditLog" AS automatic_clearance
    WHERE automatic_clearance."action" = 'MEMBER_AUTO_CLEARED'
      AND automatic_clearance."entity" = 'MemberEligibility'
      AND automatic_clearance."entityId" = eligibility."id"
  );

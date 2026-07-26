ALTER TABLE "Gift"
ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "deletedAt" TIMESTAMP(3);

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt" DESC, "id" ASC) - 1 AS position
  FROM "Gift"
)
UPDATE "Gift"
SET "displayOrder" = ranked.position
FROM ranked
WHERE "Gift"."id" = ranked."id";

CREATE INDEX "Gift_deletedAt_active_displayOrder_idx"
ON "Gift"("deletedAt", "active", "displayOrder");

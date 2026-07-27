ALTER TABLE "Gift"
ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Gift_deletedAt_active_pinned_displayOrder_idx"
ON "Gift"("deletedAt", "active", "pinned", "displayOrder");

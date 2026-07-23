-- Correct legacy cash rewards that were imported with the default physical kind.
UPDATE "Gift"
SET "kind" = 'CASH'
WHERE "kind" = 'PHYSICAL'
  AND ("name" ILIKE '%现金%' OR "name" ILIKE '%红包%');

-- PostgreSQL requires a newly added enum value to be committed before it is
-- referenced by data updates, so the catalog columns/backfill live in the
-- immediately following migration.
ALTER TYPE "GiftKind" ADD VALUE 'MEMBERSHIP';

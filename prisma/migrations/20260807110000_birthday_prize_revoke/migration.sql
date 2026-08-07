ALTER TYPE "BirthdayPrizeStatus" ADD VALUE 'REVOKED';

ALTER TABLE "BirthdayPrize" ADD COLUMN "revokedAt" TIMESTAMP(3);

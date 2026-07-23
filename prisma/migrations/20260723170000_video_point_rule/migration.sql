CREATE TABLE "VideoPointRule" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "minimumLikes" INTEGER NOT NULL DEFAULT 200,
  "fixedTierMaxLikes" INTEGER NOT NULL DEFAULT 1000,
  "fixedTierPoints" INTEGER NOT NULL DEFAULT 50,
  "likesDivisor" INTEGER NOT NULL DEFAULT 2,
  "maximumPoints" INTEGER NOT NULL DEFAULT 5000,
  "submissionWindowDays" INTEGER NOT NULL DEFAULT 7,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VideoPointRule_pkey" PRIMARY KEY ("id")
);

INSERT INTO "VideoPointRule" (
  "id",
  "minimumLikes",
  "fixedTierMaxLikes",
  "fixedTierPoints",
  "likesDivisor",
  "maximumPoints",
  "submissionWindowDays",
  "updatedAt"
)
VALUES ('default', 200, 1000, 50, 2, 5000, 7, CURRENT_TIMESTAMP);

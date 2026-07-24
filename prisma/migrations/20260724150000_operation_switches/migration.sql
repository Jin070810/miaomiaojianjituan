CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "SystemSetting_updatedAt_idx" ON "SystemSetting"("updatedAt");

ALTER TABLE "SystemSetting"
ADD CONSTRAINT "SystemSetting_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "SystemSetting" ("key", "enabled", "description")
VALUES
  ('VIDEO_SUBMISSIONS', true, '成员提交快手视频'),
  ('POINT_TRANSFERS', true, '成员积分转账'),
  ('REDEMPTIONS', true, '成员兑换礼品');

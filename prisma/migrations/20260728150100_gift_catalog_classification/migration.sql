-- Catalog classification and configurable membership fulfillment fields.
ALTER TABLE "Gift"
ADD COLUMN "category" TEXT NOT NULL DEFAULT '实用好物',
ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "fulfillmentFields" JSONB;

ALTER TABLE "RedemptionOrder"
ADD COLUMN "fulfillmentDataEnc" TEXT;

-- Classify the existing catalog from the current Chinese product names.
UPDATE "Gift"
SET "category" = CASE
  WHEN "kind" = 'CASH' THEN '现金福利'
  WHEN "name" ~* '(会员|月卡|季卡|年卡|订阅|激活码|兑换码|爱奇艺|腾讯视频|优酷|芒果TV|哔哩哔哩|剪映|CapCut|Adobe|Premiere|WPS|Canva|夸克|迅雷|网盘)' THEN '会员权益'
  WHEN "name" ~* '(iPhone|MacBook|手机|电脑|相机|CCD|大疆|DJI|拍立得|耳机|键盘|鼠标|硬盘|麦克风|补光灯)' THEN '数码设备'
  WHEN "name" ~* '(糖|蛋糕|奥利奥|零食|礼包|百醇|杨枝甘露|魔芋爽|咖啡|饮料|果汁|派)' THEN '零食饮品'
  WHEN "name" ~* '(公仔|挂件|玩偶|盲盒|手办|抱枕|胸针|贴纸|拼豆|DIY|贴画|配饰|耳钉|吊坠|戒指|手链|发夹|头绳|手机壳|叶雕|随身镜|鞋花)' THEN '潮玩周边'
  ELSE '实用好物'
END;

-- Existing unreferenced software-membership gifts can safely adopt the new
-- fulfillment type. Referenced catalog rows retain their historical type.
UPDATE "Gift" AS gift
SET "kind" = 'MEMBERSHIP'
WHERE gift."kind" = 'PHYSICAL'
  AND gift."name" ~* '(会员|月卡|季卡|年卡|订阅|激活码|兑换码|爱奇艺|腾讯视频|优酷|芒果TV|哔哩哔哩|剪映|CapCut|Adobe|Premiere|WPS|Canva|夸克|迅雷|网盘)'
  AND NOT EXISTS (SELECT 1 FROM "RedemptionOrder" orders WHERE orders."giftId" = gift."id")
  AND NOT EXISTS (SELECT 1 FROM "RankingAward" awards WHERE awards."giftId" = gift."id");

UPDATE "Gift"
SET "tags" = ARRAY[
  "category",
  CASE
    WHEN "kind" = 'CASH' THEN '现金兑换'
    WHEN "kind" = 'MEMBERSHIP' THEN '权益兑换'
    ELSE '实物商品'
  END
];

CREATE INDEX "Gift_deletedAt_active_category_idx"
ON "Gift"("deletedAt", "active", "category");

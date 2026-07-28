-- Add a descriptive tag inferred from current product names while preserving
-- the stable category and fulfillment-type tags.
UPDATE "Gift"
SET "tags" = ARRAY[
  "category",
  CASE
    WHEN "kind" = 'CASH' THEN '现金兑换'
    WHEN "kind" = 'MEMBERSHIP' THEN '权益兑换'
    ELSE '实物商品'
  END,
  CASE
    WHEN "kind" = 'MEMBERSHIP' AND "name" ~* '(爱奇艺|腾讯视频|优酷|芒果TV|哔哩哔哩)' THEN '视频会员'
    WHEN "kind" = 'MEMBERSHIP' AND "name" ~* '(剪映|CapCut|Adobe|Premiere|Canva)' THEN '剪辑软件'
    WHEN "kind" = 'MEMBERSHIP' AND "name" ~* '(WPS|网盘|夸克|迅雷)' THEN '效率工具'
    WHEN "category" = '数码设备' AND "name" ~* '(iPhone|手机|手机壳)' THEN '手机数码'
    WHEN "category" = '数码设备' AND "name" ~* '(相机|CCD|大疆|DJI|拍立得)' THEN '摄影设备'
    WHEN "category" = '数码设备' THEN '创作设备'
    WHEN "category" = '零食饮品' AND "name" ~* '(咖啡|饮料|果汁|杨枝甘露)' THEN '饮品'
    WHEN "category" = '零食饮品' THEN '零食'
    WHEN "category" = '潮玩周边' AND "name" ~* '(公仔|玩偶|盲盒|手办|抱枕)' THEN '公仔玩偶'
    WHEN "category" = '潮玩周边' AND "name" ~* '(耳钉|吊坠|戒指|手链|发夹|头绳|配饰)' THEN '饰品配件'
    WHEN "category" = '潮玩周边' AND "name" ~* '(贴纸|拼豆|DIY|贴画|叶雕)' THEN '手作周边'
    WHEN "category" = '潮玩周边' AND "name" ~* '手机壳' THEN '手机配件'
    ELSE NULL
  END
]::TEXT[]
WHERE "deletedAt" IS NULL;

-- PostgreSQL arrays retain the NULL element above; remove it for products
-- without a descriptive match.
UPDATE "Gift"
SET "tags" = array_remove("tags", NULL)
WHERE "deletedAt" IS NULL;

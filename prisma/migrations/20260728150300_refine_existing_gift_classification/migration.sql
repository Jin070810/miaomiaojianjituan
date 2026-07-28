-- Refine classification after reviewing every current catalog name. Specific
-- toy/puzzle/accessory matches precede broad words such as "手机" and "咖啡".
UPDATE "Gift"
SET "category" = CASE
  WHEN "kind" = 'CASH' THEN '现金福利'
  WHEN "kind" = 'MEMBERSHIP' THEN '会员权益'
  WHEN "name" ~* '(别墅|小米[[:space:]]*su7)' THEN '重磅大奖'
  WHEN "name" ~* '(一日女友体验权)' THEN '特别体验'
  WHEN "name" ~* '(公仔|挂件|挂饰|玩偶|盲盒|手办|抱枕|胸针|贴纸|拼豆|拼图|DIY|贴画|配饰|耳钉|吊坠|戒指|手链|发夹|头绳|手机壳|叶雕|随身镜|鞋花|安抚兔|毛绒|泡泡玛特|星星人|Q[[:space:]]*版|罗小黑|emo[[:space:]]*小猫)' THEN '潮玩周边'
  WHEN "name" ~* '(iPhone|MacBook|手机|电脑|相机|CCD|大疆|DJI|拍立得|耳机|键盘|鼠标|硬盘|麦克风|补光灯)' THEN '数码设备'
  WHEN "name" ~* '(糖|蛋糕|奥利奥|零食|礼包|百醇|杨枝甘露|魔芋爽|咖啡|饮料|果汁|派)' THEN '零食饮品'
  ELSE '实用好物'
END
WHERE "deletedAt" IS NULL;

UPDATE "Gift"
SET "tags" = array_remove(ARRAY[
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
    WHEN "category" = '重磅大奖' THEN '梦想大奖'
    WHEN "category" = '特别体验' THEN '专属体验'
    WHEN "category" = '数码设备' AND "name" ~* '(iPhone|手机)' THEN '手机数码'
    WHEN "category" = '数码设备' AND "name" ~* '(相机|CCD|大疆|DJI|拍立得)' THEN '摄影设备'
    WHEN "category" = '数码设备' THEN '创作设备'
    WHEN "category" = '零食饮品' AND "name" ~* '(咖啡|饮料|果汁|杨枝甘露)' THEN '饮品'
    WHEN "category" = '零食饮品' THEN '零食'
    WHEN "category" = '潮玩周边' AND "name" ~* '(公仔|玩偶|盲盒|手办|抱枕|安抚兔|毛绒|泡泡玛特|星星人|罗小黑|emo[[:space:]]*小猫)' THEN '公仔玩偶'
    WHEN "category" = '潮玩周边' AND "name" ~* '(耳钉|吊坠|戒指|手链|发夹|头绳|配饰)' THEN '饰品配件'
    WHEN "category" = '潮玩周边' AND "name" ~* '(贴纸|拼豆|拼图|DIY|贴画|叶雕)' THEN '手作周边'
    WHEN "category" = '潮玩周边' AND "name" ~* '手机壳' THEN '手机配件'
    ELSE NULL
  END
]::TEXT[], NULL)
WHERE "deletedAt" IS NULL;

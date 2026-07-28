import { z } from "zod";

export const MAX_GIFT_IMAGE_VALUE_LENGTH = 170_000;
export const GIFT_KINDS = ["PHYSICAL", "CASH", "MEMBERSHIP"] as const;
export const MEMBERSHIP_FIELD_TYPES = ["TEXT", "PHONE", "EMAIL", "NUMBER", "TEXTAREA", "SELECT"] as const;
export const DEFAULT_GIFT_CATEGORIES = ["实用好物", "零食饮品", "潮玩周边", "数码设备", "特别体验", "重磅大奖", "会员权益", "现金福利"] as const;

export type GiftKindValue = typeof GIFT_KINDS[number];
export type MembershipFieldType = typeof MEMBERSHIP_FIELD_TYPES[number];
export type MembershipFieldDefinition = {
  key: string;
  label: string;
  type: MembershipFieldType;
  required: boolean;
  placeholder?: string;
  options?: string[];
};

export const giftKindSchema = z.enum(GIFT_KINDS);
export const giftCategorySchema = z.string().trim().min(1).max(20);
export const giftTagsSchema = z.array(z.string().trim().min(1).max(20)).max(6);
export const membershipFieldSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/i, "字段标识只能使用字母、数字和下划线"),
  label: z.string().trim().min(1).max(30),
  type: z.enum(MEMBERSHIP_FIELD_TYPES),
  required: z.boolean().default(true),
  placeholder: z.string().trim().max(80).optional(),
  options: z.array(z.string().trim().min(1).max(40)).min(2).max(10).optional(),
}).superRefine((field, context) => {
  if (field.type === "SELECT" && !field.options?.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "下拉选择字段至少需要两个选项" });
  }
  if (field.type !== "SELECT" && field.options?.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "只有下拉选择字段可以配置选项" });
  }
  if (field.options && new Set(field.options).size !== field.options.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "下拉选项不能重复" });
  }
});
export const membershipFieldsSchema = z.array(membershipFieldSchema).max(8).superRefine((fields, context) => {
  const keys = new Set<string>();
  for (const [index, field] of fields.entries()) {
    const key = field.key.toLowerCase();
    if (keys.has(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "key"], message: "字段标识不能重复" });
    }
    keys.add(key);
  }
});

export function parseMembershipFields(value: unknown): MembershipFieldDefinition[] {
  if (value === null || value === undefined) return [];
  return membershipFieldsSchema.parse(value);
}

export function inferGiftCategory(name: string, kind: GiftKindValue): string {
  const normalized = name.trim();
  if (kind === "CASH") return "现金福利";
  if (kind === "MEMBERSHIP" || /(?:会员|月卡|季卡|年卡|订阅|激活码|兑换码|爱奇艺|腾讯视频|优酷|芒果TV|哔哩哔哩|剪映|CapCut|Adobe|Premiere|WPS|Canva|夸克|迅雷|网盘)/iu.test(normalized)) return "会员权益";
  if (/(?:别墅|小米\s*su7)/iu.test(normalized)) return "重磅大奖";
  if (/(?:一日女友体验权)/u.test(normalized)) return "特别体验";
  if (/(?:公仔|挂件|挂饰|玩偶|盲盒|手办|抱枕|胸针|贴纸|拼豆|拼图|DIY|贴画|配饰|耳钉|吊坠|戒指|手链|发夹|头绳|手机壳|叶雕|随身镜|鞋花|安抚兔|毛绒|泡泡玛特|星星人|Q\s*版|罗小黑|emo\s*小猫)/iu.test(normalized)) return "潮玩周边";
  if (/(?:iPhone|MacBook|手机|电脑|相机|CCD|大疆|DJI|拍立得|耳机|键盘|鼠标|硬盘|麦克风|补光灯)/iu.test(normalized)) return "数码设备";
  if (/(?:糖|蛋糕|奥利奥|零食|礼包|百醇|杨枝甘露|魔芋爽|咖啡|饮料|果汁|派)/u.test(normalized)) return "零食饮品";
  return "实用好物";
}

export function giftKindLabel(kind: GiftKindValue) {
  if (kind === "CASH") return "现金兑换";
  if (kind === "MEMBERSHIP") return "权益兑换";
  return "实物商品";
}

export function normalizeGiftTags(category: string, kind: GiftKindValue, tags: string[] = []) {
  const normalized = [category, giftKindLabel(kind), ...tags]
    .map((tag) => tag.trim())
    .filter(Boolean);
  return [...new Set(normalized)].slice(0, 6);
}

export function inferGiftTags(name: string, kind: GiftKindValue, category = inferGiftCategory(name, kind)) {
  const normalized = name.trim();
  const descriptive: string[] = [];
  if (kind === "MEMBERSHIP") {
    if (/(?:爱奇艺|腾讯视频|优酷|芒果TV|哔哩哔哩)/iu.test(normalized)) descriptive.push("视频会员");
    if (/(?:剪映|CapCut|Adobe|Premiere|Canva)/iu.test(normalized)) descriptive.push("剪辑软件");
    if (/(?:WPS|网盘|夸克|迅雷)/iu.test(normalized)) descriptive.push("效率工具");
  } else if (category === "数码设备") {
    if (/(?:iPhone|手机|手机壳)/iu.test(normalized)) descriptive.push("手机数码");
    if (/(?:相机|CCD|大疆|DJI|拍立得)/iu.test(normalized)) descriptive.push("摄影设备");
    if (/(?:MacBook|电脑|耳机|键盘|鼠标|硬盘|麦克风|补光灯)/iu.test(normalized)) descriptive.push("创作设备");
  } else if (category === "零食饮品") {
    descriptive.push(/(?:咖啡|饮料|果汁|杨枝甘露)/u.test(normalized) ? "饮品" : "零食");
  } else if (category === "潮玩周边") {
    if (/(?:公仔|玩偶|盲盒|手办|抱枕)/u.test(normalized)) descriptive.push("公仔玩偶");
    if (/(?:耳钉|吊坠|戒指|手链|发夹|头绳|配饰)/u.test(normalized)) descriptive.push("饰品配件");
    if (/(?:贴纸|拼豆|DIY|贴画|叶雕)/iu.test(normalized)) descriptive.push("手作周边");
    if (/手机壳/u.test(normalized)) descriptive.push("手机配件");
  } else if (category === "特别体验") {
    descriptive.push("专属体验");
  } else if (category === "重磅大奖") {
    descriptive.push("梦想大奖");
  }
  return normalizeGiftTags(category, kind, descriptive);
}

export function validateMembershipAnswers(fields: MembershipFieldDefinition[], rawAnswers: unknown) {
  const answers = z.record(z.string().max(1000)).parse(rawAnswers ?? {});
  const knownKeys = new Set(fields.map((field) => field.key));
  if (Object.keys(answers).some((key) => !knownKeys.has(key))) throw new Error("权益资料包含未知字段，请刷新后重试");

  return {
    version: 1,
    fields: fields.map((field) => {
      const value = (answers[field.key] ?? "").trim();
      if (field.required && !value) throw new Error(`请填写${field.label}`);
      if (!value) return { key: field.key, label: field.label, type: field.type, value: "" };
      if (field.type === "PHONE" && !/^[0-9+\-()\s]{6,30}$/.test(value)) throw new Error(`${field.label}格式不正确`);
      if (field.type === "EMAIL" && !z.string().email().safeParse(value).success) throw new Error(`${field.label}格式不正确`);
      if (field.type === "NUMBER" && !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error(`${field.label}必须是数字`);
      if (field.type === "SELECT" && !field.options?.includes(value)) throw new Error(`${field.label}选项无效`);
      const maxLength = field.type === "TEXTAREA" ? 500 : 200;
      if (value.length > maxLength) throw new Error(`${field.label}不能超过 ${maxLength} 个字符`);
      return { key: field.key, label: field.label, type: field.type, value };
    }),
  };
}

export function isGiftImageSource(value: string) {
  const source = value.trim();
  if (!source || source.length > MAX_GIFT_IMAGE_VALUE_LENGTH) return false;
  if (/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(source)) return true;
  if (source.length > 2000) return false;
  if (/^\/(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./%+-]+$/.test(source)) return true;
  try {
    const url = new URL(source);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export const giftImageValueSchema = z.string().trim().refine(isGiftImageSource, "礼品图片格式不正确").nullable().optional();

export function giftValidationErrorMessage(error: z.ZodError) {
  const issue = error.issues[0];
  const field = issue?.path.length ? `${issue.path.join(".")}：` : "";
  return `礼品参数不正确：${field}${issue?.message ?? "请检查输入"}`;
}

export function inferGiftKind(name: string) {
  const normalized = name.trim();
  if (/(?:现金|红包)/u.test(normalized)) return "CASH" as const;
  if (/(?:会员|月卡|季卡|年卡|订阅|激活码|兑换码|爱奇艺|腾讯视频|优酷|芒果TV|哔哩哔哩|剪映|CapCut|Adobe|Premiere|WPS|Canva|夸克|迅雷|网盘)/iu.test(normalized)) return "MEMBERSHIP" as const;
  return "PHYSICAL" as const;
}

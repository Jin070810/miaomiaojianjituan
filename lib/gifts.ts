import { z } from "zod";

export const MAX_GIFT_IMAGE_VALUE_LENGTH = 170_000;

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
  return /(?:现金|红包)/u.test(name.trim()) ? "CASH" as const : "PHYSICAL" as const;
}

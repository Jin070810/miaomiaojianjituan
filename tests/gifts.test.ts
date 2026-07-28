import { describe, expect, it } from "vitest";
import {
  giftImageValueSchema,
  inferGiftCategory,
  inferGiftTags,
  inferGiftKind,
  isGiftImageSource,
  normalizeGiftTags,
  parseMembershipFields,
  validateMembershipAnswers,
} from "@/lib/gifts";

describe("gift kind inference", () => {
  it("classifies migrated cash rewards", () => {
    expect(inferGiftKind("5元现金")).toBe("CASH");
    expect(inferGiftKind("50 元现金红包")).toBe("CASH");
  });

  it("keeps merchandise as physical rewards", () => {
    expect(inferGiftKind("原创设计浅蓝色手链")).toBe("PHYSICAL");
    expect(inferGiftKind("妙妙一日女友体验权")).toBe("PHYSICAL");
  });

  it("only classifies software and platform subscriptions as membership benefits", () => {
    expect(inferGiftKind("腾讯视频会员月卡")).toBe("MEMBERSHIP");
    expect(inferGiftKind("剪映专业版年卡")).toBe("MEMBERSHIP");
    expect(inferGiftCategory("Adobe Premiere 订阅", "PHYSICAL")).toBe("会员权益");
  });

  it("classifies current merchandise names and adds stable tags", () => {
    expect(inferGiftCategory("奶龙公仔", "PHYSICAL")).toBe("潮玩周边");
    expect(inferGiftCategory("花语咖啡屋3D立体拼图", "PHYSICAL")).toBe("潮玩周边");
    expect(inferGiftCategory("库洛米硅胶手机壳", "PHYSICAL")).toBe("潮玩周边");
    expect(inferGiftCategory("MacBook Neo", "PHYSICAL")).toBe("数码设备");
    expect(inferGiftCategory("杨枝甘露饮料", "PHYSICAL")).toBe("零食饮品");
    expect(inferGiftCategory("妙妙一日女友体验权", "PHYSICAL")).toBe("特别体验");
    expect(inferGiftCategory("小米 SU7", "PHYSICAL")).toBe("重磅大奖");
    expect(normalizeGiftTags("会员权益", "MEMBERSHIP", ["剪辑软件", "会员权益"])).toEqual(["会员权益", "权益兑换", "剪辑软件"]);
    expect(inferGiftTags("剪映专业版年卡", "MEMBERSHIP")).toEqual(["会员权益", "权益兑换", "剪辑软件"]);
  });
});

describe("membership fulfillment fields", () => {
  const fields = parseMembershipFields([
    { key: "platform", label: "开通平台", type: "SELECT", required: true, options: ["爱奇艺", "腾讯视频"] },
    { key: "account_email", label: "会员邮箱", type: "EMAIL", required: true },
    { key: "note", label: "备注", type: "TEXTAREA", required: false },
  ]);

  it("validates and snapshots configured answers", () => {
    expect(validateMembershipAnswers(fields, {
      platform: "爱奇艺",
      account_email: "member@example.com",
      note: "",
    })).toEqual({
      version: 1,
      fields: [
        { key: "platform", label: "开通平台", type: "SELECT", value: "爱奇艺" },
        { key: "account_email", label: "会员邮箱", type: "EMAIL", value: "member@example.com" },
        { key: "note", label: "备注", type: "TEXTAREA", value: "" },
      ],
    });
  });

  it("rejects missing, invalid, or unknown answers", () => {
    expect(() => validateMembershipAnswers(fields, { platform: "爱奇艺" })).toThrow("会员邮箱");
    expect(() => validateMembershipAnswers(fields, { platform: "其他", account_email: "member@example.com" })).toThrow("选项无效");
    expect(() => validateMembershipAnswers(fields, { platform: "爱奇艺", account_email: "bad", password: "secret" })).toThrow("未知字段");
  });
});

describe("gift image validation", () => {
  it("accepts existing relative paths, web URLs, and uploaded WebP values", () => {
    expect(isGiftImageSource("/gift-images/example.webp")).toBe(true);
    expect(isGiftImageSource("https://cdn.example.com/gift.jpg")).toBe(true);
    expect(giftImageValueSchema.parse("data:image/webp;base64,UklGRg==")).toContain("data:image/webp");
  });

  it("rejects unsafe or unsupported image sources", () => {
    expect(isGiftImageSource("javascript:alert(1)")).toBe(false);
    expect(isGiftImageSource("/gift-images/../secret")).toBe(false);
    expect(isGiftImageSource("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
  });
});

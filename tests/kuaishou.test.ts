import { describe, expect, it } from "vitest";
import { calculateVideoPoints, compareOwnerNames, normalizeKuaishouLink, ownerMatches, videoEligibilityError } from "@/lib/kuaishou";
import { captureVideoPublishedAt, parseKuaishouHtml } from "@/lib/kuaishou-fetch";

describe("快手链接与积分规则", () => {
  it("accepts short links, long links and share text", () => {
    expect(normalizeKuaishouLink("https://v.kuaishou.com/abc_123").requestUrl).toBe("https://v.kuaishou.com/abc_123");
    expect(normalizeKuaishouLink("https://www.kuaishou.com/short-video/123").requestUrl).toContain("/short-video/123");
    expect(normalizeKuaishouLink("复制打开快手 https://v.kuaishou.com/abc_123 看看").shortCode).toBe("abc_123");
  });

  it("applies all points boundaries", () => {
    expect(calculateVideoPoints(199)).toBe(0);
    expect(calculateVideoPoints(200)).toBe(50);
    expect(calculateVideoPoints(1000)).toBe(50);
    expect(calculateVideoPoints(1001)).toBe(500);
    expect(calculateVideoPoints(10000)).toBe(5000);
  });

  it("always returns integer points for a configured rule", () => {
    const rule = {
      minimumLikes: 300,
      fixedTierMaxLikes: 1200,
      fixedTierPoints: 75,
      likesDivisor: 3,
      maximumPoints: 4000,
      submissionWindowDays: 5,
    };
    expect(calculateVideoPoints(299, rule)).toBe(0);
    expect(calculateVideoPoints(300, rule)).toBe(75);
    expect(calculateVideoPoints(1201, rule)).toBe(400);
    expect(Number.isInteger(calculateVideoPoints(1201, rule))).toBe(true);
    expect(videoEligibilityError(
      300,
      new Date("2026-07-17T13:32:18.758Z"),
      new Date("2026-07-23T13:32:18.758Z"),
      rule,
    )).toContain("超过 5 天");
  });

  it("matches trimmed author names exactly", () => {
    expect(ownerMatches("  妙妙  ", "妙妙")).toBe(true);
    expect(ownerMatches("妙妙", "妙妙2")).toBe(false);
  });

  it("matches decorated guild names without accepting unrelated short names", () => {
    expect(compareOwnerNames("村剪辑🥀白皙", "ઇ村剪辑🥀白皙ଓ·₊ °").method).toBe("normalized");
    expect(compareOwnerNames("c玖", "₊𐙚˚c玖🥀村剪辑🐈₊.♥︎").method).toBe("group-marker");
    expect(compareOwnerNames("蓝莓", "꒰ঌ蓝莓🥀村剪辑໒꒱☘︎").method).toBe("group-marker");
    expect(compareOwnerNames("村剪辑沈妤", "村剪辑沈妤").method).toBe("exact");
    expect(ownerMatches("小年", "小念")).toBe(false);
    expect(ownerMatches("妙妙", "妙妙2")).toBe(false);
    expect(compareOwnerNames("小鱼🥀村剪辑", "小鱼村剪辑").method).toBe("normalized");
    expect(compareOwnerNames("小鱼村剪辑", "小鱼村剪辑团").method).toBe("contained");
    expect(ownerMatches("小鱼村剪辑", "祈念村剪辑")).toBe(false);
    expect(ownerMatches("芄芴🥀村剪辑", "芄̃芴̃🥀辑剪村")).toBe(true);
    expect(ownerMatches("村剪辑🥀语涵", "农民🥀语涵（接代剪）")).toBe(true);
    expect(ownerMatches("村小剪辑🥀黎清.妙（代✂️）", "村小剪辑🥀黎清ᵐⁱᵃᵒ")).toBe(true);
  });

  it("allows only a minor edit for sufficiently long names", () => {
    expect(compareOwnerNames("村剪辑小太阳", "村剪辑小太陽").method).toBe("minor-edit");
    expect(ownerMatches("小太阳", "大月亮")).toBe(false);
  });

  it("extracts the video timestamp next to likeCount", () => {
    const html = '{"timestamp":1784295138758,"likeCount":201,"viewCount":300,"photoId":"123","userName":"妙妙"}';
    expect(captureVideoPublishedAt(html)?.toISOString()).toBe("2026-07-17T13:32:18.758Z");
  });

  it("uses the quoted video photoId instead of an unquoted soundtrack id", () => {
    const html = '{"timestamp":1784295138758,"likeCount":201,"viewCount":300,"photoId":999,"userName":"妙妙","photoId":"123456"}';
    expect(parseKuaishouHtml(html).photoId).toBe("123456");
  });

  it("rejects videos outside the seven-day window or below 200 likes", () => {
    const submittedAt = new Date("2026-07-23T13:32:18.758Z");
    expect(videoEligibilityError(199, new Date("2026-07-23T12:00:00.000Z"), submittedAt)).toContain("点赞量不足");
    expect(videoEligibilityError(200, new Date("2026-07-15T13:32:18.758Z"), submittedAt)).toContain("超过 7 天");
    expect(videoEligibilityError(200, new Date("2026-07-23T13:00:00.000Z"), submittedAt)).toBeNull();
  });
});

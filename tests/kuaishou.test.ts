import { describe, expect, it } from "vitest";
import { calculateVideoPoints, normalizeKuaishouLink, ownerMatches, videoEligibilityError } from "@/lib/kuaishou";
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

  it("matches trimmed author names exactly", () => {
    expect(ownerMatches("  妙妙  ", "妙妙")).toBe(true);
    expect(ownerMatches("妙妙", "妙妙2")).toBe(false);
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

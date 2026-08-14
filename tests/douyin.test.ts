import { describe, expect, it } from "vitest";
import { buildFetchedDouyinVideo, normalizeDouyinLink, parseDouyinDetailPayload, selectDouyinDetailPayload } from "@/lib/douyin";
import { canonicalDouyinVideoUrl, canonicalVideoUrl } from "@/lib/kuaishou-url";
import { normalizeVideoLink } from "@/lib/video-links";

const ordinaryVideoShare = "8.97 复制打开抖音，看看【妙妙🥀的作品】后续来了姐妹们！他们居然是双胞胎@小小妙 # 奔现... https://v.douyin.com/a7116OX2fRw/ 12/10 :0pm j@c.aA VLj:/";
const imageNoteShare = "8.71 复制打开抖音，看看【𝑲𝒏𝒊𝒈𝒉𝒕的图文作品】image2还是太权威了😿# ... https://v.douyin.com/xLRsJENVNUo/ 04/07 pdN:/ i@C.UY :2pm";

const detailPayload = {
  aweme_detail: {
    aweme_id: "7672002006064272998",
    create_time: 1786277165,
    desc: "后续来了姐妹们！他们居然是双胞胎@小小妙 #奔现 #剧情演绎 #娱乐",
    author: { nickname: "妙妙🥀" },
    statistics: { digg_count: 18629, play_count: 0, comment_count: 973, collect_count: 2024, share_count: 3604 },
    cover: { url_list: ["https://p3-sign.douyinpic.com/example.jpg"] },
  },
};

describe("抖音链接与数据解析", () => {
  it("accepts ordinary video share text and keeps the short-link request URL", () => {
    const normalized = normalizeDouyinLink(ordinaryVideoShare);
    expect(normalized).toMatchObject({
      requestUrl: "https://v.douyin.com/a7116OX2fRw/",
      shortCode: "a7116OX2fRw",
      sourceKind: "douyin-share-text",
    });
    expect(normalizeVideoLink(ordinaryVideoShare)).toMatchObject({ platform: "douyin", shortCode: "a7116OX2fRw" });
  });

  it("accepts an image-note share and direct long video URLs", () => {
    expect(normalizeDouyinLink(imageNoteShare).shortCode).toBe("xLRsJENVNUo");
    expect(normalizeDouyinLink("https://www.douyin.com/video/7672002006064272998")).toMatchObject({
      requestUrl: "https://www.douyin.com/video/7672002006064272998",
      sourceKind: "douyin-long-link",
    });
  });

  it("reads the exact numeric digg_count instead of an abbreviated display count", () => {
    expect(parseDouyinDetailPayload(detailPayload)).toMatchObject({
      photoId: "7672002006064272998",
      likes: 18629,
      commentCount: 973,
      owner: "妙妙🥀",
      publishedAt: new Date("2026-08-09T12:06:05.000Z"),
    });
  });

  it("selects the matching aweme_id from a note or video list response", () => {
    const selected = selectDouyinDetailPayload({ aweme_list: [{ aweme_id: "other" }, detailPayload.aweme_detail] }, "7672002006064272998");
    expect(selected).toEqual({ aweme_detail: detailPayload.aweme_detail });
    expect(parseDouyinDetailPayload(selected)).toMatchObject({ photoId: "7672002006064272998", likes: 18629 });
    expect(selectDouyinDetailPayload({ aweme_list: [detailPayload.aweme_detail] }, "missing")).toBeNull();
    expect(selectDouyinDetailPayload({ aweme_detail: detailPayload.aweme_detail }, "different-id")).toBeNull();
  });

  it("rejects incomplete or approximate payloads", () => {
    expect(() => parseDouyinDetailPayload({ aweme_detail: { statistics: { digg_count: "1.9万" } } })).toThrow("完整的视频数据");
    expect(() => parseDouyinDetailPayload({})).toThrow("完整的视频数据");
  });

  it("uses the shared integer point rule and canonical Douyin history URL", () => {
    const fetched = buildFetchedDouyinVideo({
      source: normalizeDouyinLink("https://v.douyin.com/a7116OX2fRw/"),
      payload: detailPayload,
      submittedNickname: "妙妙",
      finalUrl: "https://www.douyin.com/video/7672002006064272998",
      rule: { minimumLikes: 200, fixedTierMaxLikes: 1000, fixedTierPoints: 50, likesDivisor: 2, maximumPoints: 5000, submissionWindowDays: 7 },
    });
    expect(fetched).toMatchObject({ points: 5000, ownerMatches: true, source: { platform: "douyin" } });
    expect(canonicalDouyinVideoUrl(fetched.photoId)).toBe("https://www.douyin.com/video/7672002006064272998");
    expect(canonicalVideoUrl("douyin-short-link", fetched.photoId)).toBe("https://www.douyin.com/video/7672002006064272998");
  });
});

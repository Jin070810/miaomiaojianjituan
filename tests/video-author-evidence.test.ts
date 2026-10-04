import { describe, expect, it } from "vitest";
import { parseKuaishouHtml } from "../lib/kuaishou-fetch";
import { parseDouyinDetailPayload, selectDouyinDetailPayload } from "../lib/douyin";
import { followTrustedKuaishouRedirects, parseCurlHttpResponse, trustedDouyinDetailUrl, trustedVideoPageUrl } from "../lib/video-source-policy";

const photo = { photoId: "123456", timestamp: 1784295138758, likeCount: 250, userId: "author_1", userName: "同名成员" };
const html = (data: unknown) => `<script>window.INIT_STATE = ${JSON.stringify(data)};</script>`;

describe("trusted video author evidence", () => {
  it("takes UID and exact counts from the selected work, even when a recommendation comes first", () => {
    const data = { recommendations: [{ ...photo, photoId: "other", userId: "other_author", likeCount: 9000 }], work: photo };
    expect(parseKuaishouHtml(html(data), "123456")).toMatchObject({ photoId: "123456", authorUid: "author_1", likes: 250 });
  });

  it("does not attach a viewer, commenter or unrelated user object to an authorless work", () => {
    const { userId: _uid, ...authorless } = photo;
    expect(parseKuaishouHtml(html({ viewer: { userId: "viewer" }, photo: authorless, user: { userId: "unrelated" } }), "123456").authorUid).toBeNull();
  });

  it("keeps the author within a directly associated photo.author object", () => {
    const { userId: _uid, userName: _name, ...body } = photo;
    expect(parseKuaishouHtml(html({ photo: { ...body, author: { id: "author_2", name: "改名成员" } } }), "123456"))
      .toMatchObject({ authorUid: "author_2", owner: "改名成员" });
  });

  it("rejects values assembled from different works", () => {
    expect(() => parseKuaishouHtml(html({ a: { photoId: "123456", userName: "同名成员", userId: "author_1" }, b: { timestamp: photo.timestamp, likeCount: 250 } }), "123456"))
      .toThrow("完整");
  });

  it("rejects an ambiguous page without an explicit target", () => {
    expect(() => parseKuaishouHtml(html({ photos: [photo, { ...photo, photoId: "654321" }] }))).toThrow("唯一");
  });

  it("rejects conflicting copies of the target and unsupported target IDs", () => {
    expect(() => parseKuaishouHtml(html([photo, { ...photo, userId: "different" }]), "123456")).toThrow("一致");
    expect(() => parseKuaishouHtml(html(photo), "missing")).toThrow("目标");
  });

  it("does not execute JavaScript or accept unsafe numeric author IDs", () => {
    expect(() => parseKuaishouHtml('<script>window.INIT_STATE = (() => { throw new Error("executed") })();</script>')).toThrow("完整");
    expect(parseKuaishouHtml(html({ ...photo, userId: 9007199254740992 }), "123456").authorUid).toBeNull();
    expect(parseKuaishouHtml(html({ ...photo, userId: 12345 }), "123456").authorUid).toBe("12345");
  });

  it("accepts application/json and does not read user-entered URL query UID as proof", () => {
    const document = `<a href="?userId=attacker"></a><script type="application/json">${JSON.stringify(photo)}</script>`;
    expect(parseKuaishouHtml(document, "123456").authorUid).toBe("author_1");
  });

  it("reads Douyin UID only from the selected aweme author; nickname and sec_uid are not substitutes", () => {
    const work = { aweme_id: "123", create_time: 1784295138, statistics: { digg_count: 250 }, author: { uid: "456", nickname: "同名成员", sec_uid: "opaque-profile-token" } };
    const selected = selectDouyinDetailPayload({ aweme_list: [{ ...work, aweme_id: "999", author: { ...work.author, uid: "999" } }, work] }, "123");
    expect(parseDouyinDetailPayload(selected).authorUid).toBe("456");
    expect(parseDouyinDetailPayload({ aweme_detail: { ...work, author: { nickname: "同名成员", sec_uid: "456" } } }).authorUid).toBeNull();
  });
});

describe("video source origin boundary", () => {
  it("checks every Kuaishou redirect before requesting the destination", async () => {
    const requested: string[] = [];
    await expect(followTrustedKuaishouRedirects("https://v.kuaishou.com/test", async (url) => {
      requested.push(url);
      return { status: 302, body: "", location: "https://127.0.0.1/private" };
    }, 1000)).rejects.toThrow("不受支持");
    expect(requested).toEqual(["https://v.kuaishou.com/test"]);
  });

  it("accepts a bounded trusted redirect chain and requires a complete successful response", async () => {
    const result = await followTrustedKuaishouRedirects("https://v.kuaishou.com/test", async (url) => url.includes("v.kuaishou")
      ? { status: 302, body: "", location: "https://www.kuaishou.com/short-video/123" }
      : { status: 200, body: "work", location: null }, 1000);
    expect(result).toEqual({ body: "work", finalUrl: "https://www.kuaishou.com/short-video/123" });
    await expect(followTrustedKuaishouRedirects("https://v.kuaishou.com/test", async () => ({ status: 403, body: "denied", location: null }), 1000)).rejects.toThrow("HTTP 403");
  });

  it("parses headers without treating body text as redirect metadata", () => {
    expect(parseCurlHttpResponse('HTTP/2 200\r\nContent-Type: application/json\r\n\r\n{"location":"https://bad.test"}')).toEqual({ status: 200, body: '{"location":"https://bad.test"}', location: null });
    expect(() => parseCurlHttpResponse("HTTP/2 302\r\nLocation: /one\r\nLocation: /two\r\n\r\n")).toThrow("不唯一");
  });

  it("rejects untrusted schemes, credentials, ports and lookalike detail endpoints", () => {
    for (const url of ["http://www.kuaishou.com/short-video/123", "https://user:pass@www.kuaishou.com/short-video/123", "https://www.kuaishou.com:8443/short-video/123", "https://kuaishou.com.evil.test/"]) expect(trustedVideoPageUrl(url, "kuaishou")).toBe(false);
    expect(trustedDouyinDetailUrl("https://evil.test/aweme/v1/web/aweme/detail/")).toBe(false);
    expect(trustedDouyinDetailUrl("https://www.douyin.com/?redirect=/aweme/v1/web/aweme/detail/")).toBe(false);
    expect(trustedDouyinDetailUrl("https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=123")).toBe(true);
  });
});

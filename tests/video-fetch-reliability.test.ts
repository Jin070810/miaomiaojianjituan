import { describe, expect, it } from "vitest";
import { VideoFetchError, isPermanentFetchError } from "../lib/fetch-errors";
import { concatUtf8Chunks, fetchKuaishouVideo, parseKuaishouHtml } from "../lib/kuaishou-fetch";
import { fetchDouyinVideo } from "../lib/douyin-fetch";
import { DEFAULT_VIDEO_POINT_RULE } from "../lib/point-rules";
import { resolveFetchFailureAction } from "../lib/video-jobs";

describe("视频抓取错误分类", () => {
  it("无效快手链接判定为确定性失败（permanent）", async () => {
    await expect(fetchKuaishouVideo("这不是一个链接", "测试昵称")).rejects.toMatchObject({
      name: "VideoFetchError",
      kind: "permanent",
    });
  });

  it("无效抖音链接判定为确定性失败（permanent）", async () => {
    await expect(fetchDouyinVideo("随便一段话没有链接", "测试昵称", DEFAULT_VIDEO_POINT_RULE))
      .rejects.toMatchObject({ name: "VideoFetchError", kind: "permanent" });
  });

  it("快手页面数据不完整判定为瞬时失败（transient），可交给队列重试", () => {
    expect(() => parseKuaishouHtml("<html><body>壳页</body></html>")).toThrowError(VideoFetchError);
    try {
      parseKuaishouHtml("<html><body>壳页</body></html>");
    } catch (error) {
      expect(isPermanentFetchError(error)).toBe(false);
    }
  });

  it("resolveFetchFailureAction：确定性失败直接驳回，瞬时错误重试，终局尝试驳回", () => {
    const permanent = new VideoFetchError("没有识别到有效的抖音链接", "permanent");
    const transient = new VideoFetchError("抖音未返回可验证的点赞数据", "transient");
    const unknown = new Error("socket hang up");

    expect(resolveFetchFailureAction(permanent, false)).toBe("reject-permanent");
    expect(resolveFetchFailureAction(permanent, true)).toBe("reject-permanent");
    expect(resolveFetchFailureAction(transient, false)).toBe("retry");
    expect(resolveFetchFailureAction(transient, true)).toBe("reject-final");
    // 未分类的未知错误按瞬时处理，交给队列重试而非立即驳回。
    expect(resolveFetchFailureAction(unknown, false)).toBe("retry");
    expect(resolveFetchFailureAction(unknown, true)).toBe("reject-final");
  });
});

describe("concatUtf8Chunks", () => {
  it("跨 chunk 边界的多字节字符不会被截断破坏", () => {
    const text = "巧".repeat(30_000);
    const raw = Buffer.from(text, "utf8");
    // 模拟 Node stream 的 64KB chunk，切割点落在 3 字节中文字符内部。
    const chunks = [raw.subarray(0, 65_534), raw.subarray(65_534)];
    expect(chunks[1].length).toBeGreaterThan(0);
    expect(concatUtf8Chunks(chunks)).toBe(text);
    expect(chunks[0].toString("utf8")).toContain("\uFFFD");
  });

  it("空输入返回空字符串", () => {
    expect(concatUtf8Chunks([])).toBe("");
  });
});

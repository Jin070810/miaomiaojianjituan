import { spawn } from "node:child_process";
import { normalizeKuaishouLink, calculateVideoPoints, compareOwnerNames } from "./kuaishou";
import { DEFAULT_VIDEO_POINT_RULE, VideoPointRuleConfig } from "./point-rules";
import { VideoFetchError } from "./fetch-errors";
import { parseStructuredKuaishouWork } from "./video-author-evidence";
import { followTrustedKuaishouRedirects, parseCurlHttpResponse } from "./video-source-policy";

export type FetchedKuaishouVideo = {
  source: ReturnType<typeof normalizeKuaishouLink>;
  likes: number;
  views: number | null;
  commentCount: number | null;
  caption: string | null;
  coverUrl: string | null;
  publishedAt: Date;
  photoId: string;
  owner: string;
  authorUid: string | null;
  points: number;
  rawHtml: string;
  ownerMatches: boolean;
  ownerMatchMethod: ReturnType<typeof compareOwnerNames>["method"];
};

// 多字节 UTF-8 字符可能跨 chunk 边界，必须拼接后再整体解码；
// 逐 chunk toString 会把中文字段（作者名/文案）破坏为 U+FFFD，导致作者被误判不一致。
export function concatUtf8Chunks(chunks: Buffer[]) {
  return Buffer.concat(chunks).toString("utf8");
}

function runCurlResponse(url: string, timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("curl", [
      "-sS",
      "--include",
      "--suppress-connect-headers",
      "--proto", "=https",
      "--proto-redir", "=https",
      "--max-redirs", "0",
      "--connect-timeout", "5",
      "-A", "Mozilla/5.0",
      "--max-time", String(Math.ceil(timeoutMs / 1000)),
      url,
    ], {
      shell: false,
      windowsHide: true,
    });
    let stderr = "";
    let oversized = false;
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs + 500);
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      totalBytes += chunk.length;
      if (totalBytes > 5_000_000) {
        oversized = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (oversized) reject(new Error("快手页面响应过大，已停止处理"));
      else if (code !== 0) reject(new Error(stderr || `curl exited with ${code}`));
      else resolve(concatUtf8Chunks(chunks));
    });
  });
}

async function runCurlPage(url: string, timeoutMs = 10_000) {
  return followTrustedKuaishouRedirects(url, async (target, remainingMs) => (
    parseCurlHttpResponse(await runCurlResponse(target, remainingMs))
  ), timeoutMs);
}

async function runCurl(url: string, timeoutMs = 10_000) {
  return (await runCurlPage(url, timeoutMs)).body;
}

export function captureVideoPublishedAt(html: string) {
  const likeMatch = /"likeCount"\s*:\s*\d+/.exec(html);
  if (!likeMatch) return null;
  const preceding = html.slice(Math.max(0, likeMatch.index - 2500), likeMatch.index);
  const timestamps = [...preceding.matchAll(/"timestamp"\s*:\s*(\d{10,13})/g)];
  const raw = timestamps.at(-1)?.[1];
  if (!raw) return null;
  const numeric = Number(raw);
  const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const publishedAt = new Date(milliseconds);
  return Number.isNaN(publishedAt.getTime()) ? null : publishedAt;
}

export function parseKuaishouHtml(rawHtml: string, expectedPhotoId?: string | null) {
  try {
    return parseStructuredKuaishouWork(rawHtml, expectedPhotoId);
  } catch (error) {
    throw new VideoFetchError(error instanceof Error ? error.message : "快手页面未返回完整的视频数据，请稍后重试", "transient");
  }
}

export async function fetchKuaishouVideo(
  input: string,
  submittedNickname: string,
  rule: VideoPointRuleConfig = DEFAULT_VIDEO_POINT_RULE,
): Promise<FetchedKuaishouVideo> {
  let source: ReturnType<typeof normalizeKuaishouLink>;
  try {
    source = normalizeKuaishouLink(input);
  } catch (error) {
    throw new VideoFetchError(error instanceof Error ? error.message : "快手链接无效", "permanent");
  }
  let lastError: unknown;
  // Kuaishou occasionally returns a shell page before the embedded JSON is
  // available. Retry the same normalized URL with a bounded backoff before
  // treating it as an unavailable/deleted video.
  const retryDelays = [0, 300, 800, 1_500, 3_000];
  for (let attempt = 1; attempt <= retryDelays.length; attempt += 1) {
    try {
      if (retryDelays[attempt - 1] > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt - 1]));
      }
      const response = await runCurlPage(source.requestUrl);
      const rawHtml = response.body;
      const targetId = new URL(response.finalUrl).pathname.match(/^\/(?:short-video|fw\/photo)\/([A-Za-z0-9_-]+)\/?$/)?.[1];
      if (!targetId) throw new VideoFetchError("快手跳转后未返回可识别的作品地址，请使用作品长链接重新提交", "permanent");
      const parsed = parseKuaishouHtml(rawHtml, targetId);
      const ownerComparison = compareOwnerNames(submittedNickname, parsed.owner);
      return {
        source,
        ...parsed,
        points: calculateVideoPoints(parsed.likes, rule),
        rawHtml,
        ownerMatches: ownerComparison.matches,
        ownerMatchMethod: ownerComparison.method,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof VideoFetchError && error.kind === "permanent") throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("快手页面抓取失败，请稍后重试");
}

export { runCurl };

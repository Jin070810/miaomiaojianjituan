import { spawn } from "node:child_process";
import { normalizeKuaishouLink, calculateVideoPoints, ownerMatches } from "./kuaishou";

export type FetchedKuaishouVideo = {
  source: ReturnType<typeof normalizeKuaishouLink>;
  likes: number;
  views: number | null;
  publishedAt: Date;
  photoId: string;
  owner: string;
  points: number;
  rawHtml: string;
  ownerMatches: boolean;
};

function runCurl(url: string, timeoutMs = 10_000) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("curl", [
      "-sS",
      "-L",
      "--proto", "=https",
      "--proto-redir", "=https",
      "--max-redirs", "5",
      "--connect-timeout", "5",
      "-A", "Mozilla/5.0",
      "--max-time", String(Math.ceil(timeoutMs / 1000)),
      url,
    ], {
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let oversized = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs + 500);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 5_000_000) {
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
      else if (code !== 0 && !stdout) reject(new Error(stderr || `curl exited with ${code}`));
      else resolve(stdout);
    });
  });
}

function capture(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1] ?? null;
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

export function parseKuaishouHtml(rawHtml: string) {
  const likesText = capture(rawHtml, /"likeCount"\s*:\s*(\d+)/);
  const photoId = capture(rawHtml, /"photoId"\s*:\s*"(\d+)"/);
  const owner = capture(rawHtml, /"userName"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const viewsText = capture(rawHtml, /"viewCount"\s*:\s*(\d+)/);
  const publishedAt = captureVideoPublishedAt(rawHtml);
  if (!likesText || !photoId || owner === null || !publishedAt) {
    throw new Error("快手页面未返回完整的视频数据，请稍后重试");
  }
  const decodedOwner = owner.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const likes = Number(likesText);
  const views = viewsText ? Number(viewsText) : null;
  return { likes, views, publishedAt, photoId, owner: decodedOwner };
}

export async function fetchKuaishouVideo(input: string, submittedNickname: string): Promise<FetchedKuaishouVideo> {
  const source = normalizeKuaishouLink(input);
  const rawHtml = await runCurl(source.requestUrl);
  const parsed = parseKuaishouHtml(rawHtml);
  return {
    source,
    ...parsed,
    points: calculateVideoPoints(parsed.likes),
    rawHtml,
    ownerMatches: ownerMatches(submittedNickname, parsed.owner),
  };
}

export { runCurl };

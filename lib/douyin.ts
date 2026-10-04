import { calculateVideoPoints, compareOwnerNames } from "./kuaishou";
import { stableAuthorUid } from "./video-author-evidence";

export type DouyinSourceKind = "douyin-short-link" | "douyin-long-link" | "douyin-share-text";

export type NormalizedDouyinLink = {
  platform: "douyin";
  sourceUrl: string;
  requestUrl: string;
  shortCode?: string;
  sourceKind: DouyinSourceKind;
};

const SHORT_LINK_PATTERN = /https?:\/\/v\.douyin\.com\/([A-Za-z0-9_-]+)\/?/i;
const LONG_LINK_PATTERN = /https?:\/\/(?:www\.)?(?:douyin\.com|iesdouyin\.com)\/(?:(?:share\/)?(?:video|note))\/([A-Za-z0-9_-]+)/i;
const ALLOWED_HOSTS = new Set(["v.douyin.com", "douyin.com", "www.douyin.com", "iesdouyin.com", "www.iesdouyin.com"]);

function asUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function stripTrailingPunctuation(value: string) {
  return value.replace(/[，。！？；：,.!?;:）)\]】》]+$/g, "");
}

function isAllowedDouyinUrl(value: URL) {
  return ALLOWED_HOSTS.has(value.hostname.toLowerCase());
}

function canonicalRequestUrl(value: string) {
  const url = asUrl(value);
  if (!url || !isAllowedDouyinUrl(url)) return null;
  url.hash = "";
  return url.toString();
}

function isStandaloneUrl(input: string, matchedUrl: string) {
  return input === matchedUrl;
}

/** Accepts a Douyin URL or the full share text copied from the Douyin app. */
export function normalizeDouyinLink(input: string): NormalizedDouyinLink {
  const sourceUrl = stripTrailingPunctuation(input.trim());
  if (!sourceUrl) throw new Error("请输入抖音视频链接");

  const shortMatch = sourceUrl.match(SHORT_LINK_PATTERN);
  if (shortMatch) {
    return {
      platform: "douyin",
      sourceUrl,
      requestUrl: `https://v.douyin.com/${shortMatch[1]}/`,
      shortCode: shortMatch[1],
      sourceKind: asUrl(sourceUrl)?.hostname.toLowerCase() === "v.douyin.com" ? "douyin-short-link" : "douyin-share-text",
    };
  }

  const longMatch = sourceUrl.match(LONG_LINK_PATTERN);
  if (longMatch) {
    const matchedUrl = stripTrailingPunctuation(sourceUrl.match(/https?:\/\/[^\s]+/i)?.[0] ?? sourceUrl);
    const requestUrl = canonicalRequestUrl(matchedUrl);
    if (requestUrl) {
      const matchedHost = asUrl(matchedUrl)?.hostname.toLowerCase();
      return {
        platform: "douyin",
        sourceUrl,
        requestUrl,
        shortCode: longMatch[1],
        sourceKind: isStandaloneUrl(sourceUrl, matchedUrl) && matchedHost !== undefined ? "douyin-long-link" : "douyin-share-text",
      };
    }
  }

  const direct = asUrl(sourceUrl);
  if (direct && isAllowedDouyinUrl(direct)) {
    const requestUrl = canonicalRequestUrl(sourceUrl);
    if (requestUrl && /\/(?:video|note)\//i.test(direct.pathname)) {
      return { platform: "douyin", sourceUrl, requestUrl, sourceKind: "douyin-long-link" };
    }
  }

  throw new Error("没有识别到有效的抖音链接，请检查分享内容后重试");
}

export function isDouyinSourceKind(sourceKind: string | null | undefined): sourceKind is DouyinSourceKind {
  return sourceKind?.startsWith("douyin-") ?? false;
}

export type ParsedDouyinDetail = {
  likes: number;
  views: number | null;
  commentCount: number | null;
  caption: string | null;
  coverUrl: string | null;
  publishedAt: Date;
  photoId: string;
  owner: string;
  authorUid: string | null;
};

/** Normalizes both the detail response and the note/video list response to one aweme_detail shape. */
export function selectDouyinDetailPayload(payload: unknown, awemeId: string | null) {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as { aweme_detail?: unknown; aweme_list?: unknown };
  if (data.aweme_detail && typeof data.aweme_detail === "object") {
    const detailId = (data.aweme_detail as { aweme_id?: unknown }).aweme_id;
    return !awemeId || detailId === awemeId ? payload : null;
  }
  if (!awemeId || !Array.isArray(data.aweme_list)) return null;
  const matched = data.aweme_list.find((item) => (
    item && typeof item === "object" && (item as { aweme_id?: unknown }).aweme_id === awemeId
  ));
  return matched ? { aweme_detail: matched } : null;
}

function safePublicImageUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function integerOrNull(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseDouyinDetailPayload(payload: unknown): ParsedDouyinDetail {
  if (!payload || typeof payload !== "object") throw new Error("抖音页面未返回有效的视频数据");
  const detail = (payload as { aweme_detail?: unknown }).aweme_detail;
  if (!detail || typeof detail !== "object") throw new Error("抖音页面未返回完整的视频数据，请稍后重试");
  const data = detail as Record<string, unknown>;
  const statistics = data.statistics && typeof data.statistics === "object" ? data.statistics as Record<string, unknown> : {};
  const author = data.author && typeof data.author === "object" ? data.author as Record<string, unknown> : {};
  const likes = integerOrNull(statistics.digg_count);
  const photoId = typeof data.aweme_id === "string" ? data.aweme_id.trim() : "";
  const owner = typeof author.nickname === "string" ? author.nickname.trim() : "";
  const publishedSeconds = integerOrNull(data.create_time);
  if (likes === null || !/^\d+$/.test(photoId) || !owner || publishedSeconds === null) {
    throw new Error("抖音页面未返回完整的视频数据，请稍后重试");
  }
  const publishedAt = new Date(publishedSeconds * 1000);
  if (Number.isNaN(publishedAt.getTime())) throw new Error("抖音视频发布时间无效，请稍后重试");
  const cover = data.cover && typeof data.cover === "object" ? data.cover as Record<string, unknown> : {};
  const coverUrls = Array.isArray(cover.url_list) ? cover.url_list : [];
  const caption = typeof data.desc === "string" ? data.desc.trim() || null : typeof data.caption === "string" ? data.caption.trim() || null : null;
  return {
    likes,
    views: integerOrNull(statistics.play_count),
    commentCount: integerOrNull(statistics.comment_count),
    caption,
    coverUrl: safePublicImageUrl(coverUrls.find((item): item is string => typeof item === "string")),
    publishedAt,
    photoId,
    owner,
    authorUid: stableAuthorUid(author.uid),
  };
}

export function buildFetchedDouyinVideo(input: {
  source: NormalizedDouyinLink;
  payload: unknown;
  submittedNickname: string;
  finalUrl: string;
  rule: Parameters<typeof calculateVideoPoints>[1];
}) {
  const parsed = parseDouyinDetailPayload(input.payload);
  const ownerComparison = compareOwnerNames(input.submittedNickname, parsed.owner);
  return {
    source: input.source,
    ...parsed,
    points: calculateVideoPoints(parsed.likes, input.rule),
    ownerMatches: ownerComparison.matches,
    ownerMatchMethod: ownerComparison.method,
    rawPayload: {
      platform: "douyin",
      finalUrl: input.finalUrl,
      detailEndpoint: "https://www.douyin.com/aweme/v1/web/aweme/detail/",
    },
  };
}

import { DEFAULT_VIDEO_POINT_RULE, VideoPointRuleConfig } from "./point-rules";

export type KuaishouSourceKind = "short-link" | "long-link" | "share-text";

export type NormalizedKuaishouLink = {
  sourceUrl: string;
  requestUrl: string;
  shortCode?: string;
  sourceKind: KuaishouSourceKind;
};

const SHORT_LINK_PATTERN = /https?:\/\/v\.kuaishou\.com\/([A-Za-z0-9_-]+)/i;
const LONG_LINK_PATTERN = /https?:\/\/(?:www\.)?kuaishou\.com\/short-video\/([A-Za-z0-9_-]+)/i;

function asUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function stripTrailingPunctuation(value: string) {
  return value.replace(/[，。！？；：,.!?;:)\]】》]+$/g, "");
}

/**
 * Accepts a pasted URL or the text around a URL copied from a Kuaishou share sheet.
 * The worker can use requestUrl for fetching and sourceUrl for audit/display.
 */
export function normalizeKuaishouLink(input: string): NormalizedKuaishouLink {
  const sourceUrl = stripTrailingPunctuation(input.trim());
  if (!sourceUrl) {
    throw new Error("请输入快手视频链接");
  }

  const shortMatch = sourceUrl.match(SHORT_LINK_PATTERN);
  if (shortMatch) {
    return {
      sourceUrl,
      requestUrl: `https://v.kuaishou.com/${shortMatch[1]}`,
      shortCode: shortMatch[1],
      sourceKind: asUrl(sourceUrl)?.hostname === "v.kuaishou.com" ? "short-link" : "share-text",
    };
  }

  const longMatch = sourceUrl.match(LONG_LINK_PATTERN);
  if (longMatch) {
    const extractedUrl = `https://www.kuaishou.com/short-video/${longMatch[1]}`;
    return {
      sourceUrl,
      requestUrl: extractedUrl,
      shortCode: longMatch[1],
      sourceKind: asUrl(sourceUrl)?.hostname === "www.kuaishou.com" ? "long-link" : "share-text",
    };
  }

  const direct = asUrl(sourceUrl);
  if (direct && /(^|\.)kuaishou\.com$/i.test(direct.hostname)) {
    return {
      sourceUrl,
      requestUrl: direct.toString(),
      sourceKind: "long-link",
    };
  }

  throw new Error("没有识别到有效的快手链接，请检查分享内容后重试");
}

export function calculateVideoPoints(likes: number, rule: VideoPointRuleConfig = DEFAULT_VIDEO_POINT_RULE) {
  if (!Number.isFinite(likes) || likes < rule.minimumLikes) return 0;
  if (likes <= rule.fixedTierMaxLikes) return rule.fixedTierPoints;
  return Math.min(rule.maximumPoints, Math.floor(likes / rule.likesDivisor));
}

const GROUP_NAME_MARKERS = ["村小剪辑", "村剪辑", "妙徒"];

function normalizedOwnerName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replaceAll("辑剪村", "村剪辑")
    .replaceAll("miao", "妙")
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, "");
}

function withoutGroupMarkers(value: string) {
  return GROUP_NAME_MARKERS.reduce((current, marker) => current.replaceAll(marker, ""), value);
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function safeContainment(left: string, right: string) {
  const contains = left.includes(right) || right.includes(left);
  const shortest = Math.min(left.length, right.length);
  const longest = Math.max(left.length, right.length);
  const lengthDifference = longest - shortest;
  return contains &&
    shortest >= 2 &&
    (shortest >= 3 || lengthDifference >= 2) &&
    !(lengthDifference === 1 && /\d/.test(left + right));
}

export type OwnerMatchResult = {
  matches: boolean;
  method: "exact" | "normalized" | "contained" | "group-marker" | "minor-edit" | "none";
  submittedNormalized: string;
  fetchedNormalized: string;
};

export function compareOwnerNames(submittedNickname: string, fetchedOwner: string): OwnerMatchResult {
  const submittedTrimmed = submittedNickname.trim();
  const fetchedTrimmed = fetchedOwner.trim();
  const submittedNormalized = normalizedOwnerName(submittedTrimmed);
  const fetchedNormalized = normalizedOwnerName(fetchedTrimmed);
  const result = (matches: boolean, method: OwnerMatchResult["method"]): OwnerMatchResult => ({
    matches,
    method,
    submittedNormalized,
    fetchedNormalized,
  });
  if (submittedTrimmed === fetchedTrimmed) return result(true, "exact");
  if (submittedNormalized && submittedNormalized === fetchedNormalized) return result(true, "normalized");
  const submittedCore = withoutGroupMarkers(submittedNormalized);
  const fetchedCore = withoutGroupMarkers(fetchedNormalized);
  if (submittedCore.length >= 2 && submittedCore === fetchedCore) return result(true, "group-marker");

  // The historical Feishu workflow accepted harmless suffixes/prefixes after
  // removing emoji and symbols. Keep the same behavior, while rejecting a
  // one-character numeric suffix on very short names.
  if (safeContainment(submittedNormalized, fetchedNormalized)) {
    return result(true, "contained");
  }
  if (safeContainment(submittedCore, fetchedCore)) return result(true, "contained");

  const coreLongest = Math.max(submittedCore.length, fetchedCore.length);
  const coreShortest = Math.min(submittedCore.length, fetchedCore.length);
  if (coreShortest >= 3 && coreLongest - coreShortest <= 1 && editDistance(submittedCore, fetchedCore) <= 1) {
    return result(true, "minor-edit");
  }
  return result(false, "none");
}

export function ownerMatches(submittedNickname: string, fetchedOwner: string) {
  return compareOwnerNames(submittedNickname, fetchedOwner).matches;
}

export const VIDEO_SUBMISSION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function videoEligibilityError(
  likes: number,
  publishedAt: Date,
  submittedAt: Date,
  rule: VideoPointRuleConfig = DEFAULT_VIDEO_POINT_RULE,
) {
  if (likes < rule.minimumLikes) return `视频点赞量不足 ${rule.minimumLikes}，暂不可兑换积分`;
  const age = submittedAt.getTime() - publishedAt.getTime();
  if (age < -5 * 60 * 1000) return "视频发布时间异常，请稍后重试";
  if (age > rule.submissionWindowDays * 24 * 60 * 60 * 1000) return `视频发布时间已超过 ${rule.submissionWindowDays} 天，不可提交`;
  return null;
}

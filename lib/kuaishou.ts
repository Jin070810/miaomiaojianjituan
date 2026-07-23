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

export function calculateVideoPoints(likes: number) {
  if (!Number.isFinite(likes) || likes < 200) return 0;
  if (likes <= 1000) return 50;
  return Math.min(5000, Math.floor(likes / 2));
}

export function ownerMatches(submittedNickname: string, fetchedOwner: string) {
  return submittedNickname.trim() === fetchedOwner.trim();
}

export const VIDEO_SUBMISSION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function videoEligibilityError(likes: number, publishedAt: Date, submittedAt: Date) {
  if (likes < 200) return "视频点赞量不足 200，暂不可兑换积分";
  const age = submittedAt.getTime() - publishedAt.getTime();
  if (age < -5 * 60 * 1000) return "视频发布时间异常，请稍后重试";
  if (age > VIDEO_SUBMISSION_WINDOW_MS) return "视频发布时间已超过 7 天，不可提交";
  return null;
}

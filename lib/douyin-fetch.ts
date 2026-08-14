import { chromium, type Browser } from "playwright-core";
import { buildFetchedDouyinVideo, normalizeDouyinLink, selectDouyinDetailPayload } from "./douyin";
import { type VideoPointRuleConfig } from "./point-rules";

export type FetchedDouyinVideo = ReturnType<typeof buildFetchedDouyinVideo>;

let browserPromise: Promise<Browser> | null = null;

function isDouyinPageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^(?:www\.)?(?:douyin|iesdouyin)\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function getBrowser() {
  return (browserPromise ??= chromium.launch({
    headless: true,
    executablePath: process.env.DOUYIN_BROWSER_EXECUTABLE_PATH || (process.platform === "linux" ? "/usr/bin/chromium" : undefined),
    args: ["--headless=new", "--disable-dev-shm-usage", "--no-sandbox", "--disable-blink-features=AutomationControlled"],
  }));
}

function canonicalIesShareUrl(value: string) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/(video|note)\/(\d+)/i);
    return match ? `https://www.iesdouyin.com/share/${match[1].toLowerCase()}/${match[2]}/` : null;
  } catch {
    return null;
  }
}

function awemeIdFromPageUrl(value: string) {
  try {
    return new URL(value).pathname.match(/^\/(?:video|note)\/(\d+)/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function fetchDouyinVideo(
  input: string,
  submittedNickname: string,
  rule: VideoPointRuleConfig,
): Promise<FetchedDouyinVideo> {
  const source = normalizeDouyinLink(input);
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  let detailPayload: unknown;
  let targetAwemeId: string | null = null;
  const pendingPayloads: unknown[] = [];
  let detailResolve: ((payload: unknown) => void) | null = null;
  const detailPromise = new Promise<unknown>((resolve) => { detailResolve = resolve; });
  const tryResolvePayload = (payload: unknown) => {
    if (!targetAwemeId) return;
    const selected = selectDouyinDetailPayload(payload, targetAwemeId);
    if (!selected) return;
    detailPayload = selected;
    detailResolve?.(selected);
  };
  page.on("response", (response) => {
    const responseUrl = response.url();
    if (!responseUrl.includes("/aweme/v1/web/aweme/detail/") && !responseUrl.includes("/aweme/v1/web/aweme/post/")) return;
    void response.finished().then(() => response.json()).then((payload) => {
      pendingPayloads.push(payload);
      tryResolvePayload(payload);
    }).catch(() => undefined);
  });
  try {
    await page.goto(source.requestUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
    if (!isDouyinPageUrl(page.url())) throw new Error("抖音链接跳转到了不受支持的页面");
    targetAwemeId = awemeIdFromPageUrl(page.url());
    for (const payload of pendingPayloads) tryResolvePayload(payload);
    await Promise.race([detailPromise, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    if (!detailPayload) {
      const shareUrl = canonicalIesShareUrl(page.url());
      if (shareUrl) {
        await page.goto(shareUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
        await Promise.race([detailPromise, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      }
    }
    if (!detailPayload) throw new Error("抖音未返回可验证的点赞数据，请稍后重试");
    return buildFetchedDouyinVideo({
      source,
      payload: detailPayload,
      submittedNickname,
      finalUrl: page.url(),
      rule,
    });
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function closeDouyinBrowser() {
  const current = browserPromise;
  browserPromise = null;
  if (!current) return;
  const browser = await current.catch(() => null);
  await browser?.close().catch(() => undefined);
}

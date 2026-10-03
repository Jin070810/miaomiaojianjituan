import { chromium, type Browser } from "playwright-core";
import { buildFetchedDouyinVideo, normalizeDouyinLink, selectDouyinDetailPayload } from "./douyin";
import { type VideoPointRuleConfig } from "./point-rules";
import { VideoFetchError } from "./fetch-errors";
import { trustedDouyinDetailUrl, trustedVideoPageUrl } from "./video-source-policy";

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
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      executablePath: process.env.DOUYIN_BROWSER_EXECUTABLE_PATH || (process.platform === "linux" ? "/usr/bin/chromium" : undefined),
      args: ["--headless=new", "--disable-dev-shm-usage", "--no-sandbox", "--disable-blink-features=AutomationControlled"],
    }).then((browser) => {
      // Chromium 进程崩溃后重置单例，下一次抓取会重新拉起浏览器，而不是永久失败。
      browser.on("disconnected", () => {
        browserPromise = null;
      });
      return browser;
    }, (error) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

// Promise.race 的计时器必须在赛结束后清理，否则每个慢请求都会遗留悬挂定时器。
async function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  let source: ReturnType<typeof normalizeDouyinLink>;
  try {
    source = normalizeDouyinLink(input);
  } catch (error) {
    throw new VideoFetchError(error instanceof Error ? error.message : "抖音链接无效", "permanent");
  }
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame() && !trustedVideoPageUrl(request.url(), "douyin")) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
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
    if (!trustedDouyinDetailUrl(responseUrl)) return;
    void response.finished().then(() => response.json()).then((payload) => {
      // pendingPayloads 仅用于在拿到目标 awemeId 前暂存早到的响应，给个上限避免异常页面无限累积。
      if (pendingPayloads.length < 20) pendingPayloads.push(payload);
      tryResolvePayload(payload);
    }).catch(() => undefined);
  });
  try {
    await page.goto(source.requestUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
    if (!isDouyinPageUrl(page.url())) throw new VideoFetchError("抖音链接跳转到了不受支持的页面", "permanent");
    targetAwemeId = awemeIdFromPageUrl(page.url());
    for (const payload of pendingPayloads) tryResolvePayload(payload);
    await raceWithTimeout(detailPromise, 10_000);
    if (!detailPayload) {
      const shareUrl = canonicalIesShareUrl(page.url());
      if (shareUrl) {
        await page.goto(shareUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
        await raceWithTimeout(detailPromise, 10_000);
      }
    }
    if (!detailPayload) throw new VideoFetchError("抖音未返回可验证的点赞数据，请稍后重试", "transient");
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

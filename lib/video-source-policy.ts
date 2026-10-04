const KUAISHOU_HOSTS = new Set(["v.kuaishou.com", "www.kuaishou.com", "kuaishou.com", "m.kuaishou.com"]);
const DOUYIN_HOSTS = new Set(["v.douyin.com", "www.douyin.com", "douyin.com", "www.iesdouyin.com", "iesdouyin.com"]);

export function trustedVideoPageUrl(value: string, platform: "kuaishou" | "douyin") {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    return (platform === "kuaishou" ? KUAISHOU_HOSTS : DOUYIN_HOSTS).has(url.hostname.toLowerCase());
  } catch { return false; }
}

export function trustedDouyinDetailUrl(value: string) {
  if (!trustedVideoPageUrl(value, "douyin")) return false;
  const url = new URL(value);
  return url.hostname === "www.douyin.com" && ["/aweme/v1/web/aweme/detail/", "/aweme/v1/web/aweme/post/"].includes(url.pathname);
}

/** curl emits headers before the body; CONNECT headers are suppressed at source. */
export function parseCurlHttpResponse(response: string): { status: number; body: string; location: string | null } {
  let remaining = response;
  while (true) {
    const boundary = /\r?\n\r?\n/.exec(remaining);
    if (!boundary) throw new Error("快手返回了无效的 HTTP 响应");
    const lines = remaining.slice(0, boundary.index).split(/\r?\n/);
    const status = Number(/^HTTP\/[\d.]+\s+(\d{3})\b/.exec(lines.shift() ?? "")?.[1]);
    if (!Number.isInteger(status) || status < 100) throw new Error("快手返回了无效的 HTTP 状态");
    const body = remaining.slice(boundary.index + boundary[0].length);
    if (status < 200) { remaining = body; continue; }
    const locations = lines.filter((line) => /^location:/i.test(line));
    if (locations.length > 1) throw new Error("快手页面跳转地址不唯一");
    return { status, body, location: locations[0]?.slice(locations[0].indexOf(":") + 1).trim() ?? null };
  }
}

export async function followTrustedKuaishouRedirects(
  initialUrl: string,
  request: (url: string, remainingMs: number) => Promise<ReturnType<typeof parseCurlHttpResponse>>,
  timeoutMs: number,
) {
  let url = initialUrl;
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop <= 5; hop += 1) {
    if (!trustedVideoPageUrl(url, "kuaishou")) throw new Error("快手链接跳转到了不受支持的地址");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("快手页面请求超时");
    const response = await request(url, remaining);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location || hop === 5) throw new Error("快手页面跳转次数过多或地址缺失");
      url = new URL(response.location, url).toString();
      continue;
    }
    if (response.status !== 200) throw new Error(`快手页面请求未成功（HTTP ${response.status}）`);
    return { body: response.body, finalUrl: url };
  }
  throw new Error("快手页面跳转次数过多");
}

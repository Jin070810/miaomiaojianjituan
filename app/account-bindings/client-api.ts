export async function bindingJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(payload?.error ?? "服务暂时不可用，请稍后重试");
  return payload as T;
}

export function platformLabel(platform: string) { return platform === "douyin" ? "抖音" : "快手"; }
export function bindingDate(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
export function bindingRequestStatus(value: string) { return ({ PENDING: "待核验", APPROVED: "已通过", REJECTED: "未通过" } as Record<string, string>)[value] ?? value; }

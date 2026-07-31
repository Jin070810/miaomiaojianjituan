export type AdminSection = "workbench" | "overview" | "videos" | "users" | "points" | "gifts" | "orders" | "rankings" | "challenges" | "announcements" | "logs" | "settings";

export class AdminFetchError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type Fetcher = typeof fetch;

export function buildAdminUsersPath(input: { page?: number; take?: number; search?: string } = {}) {
  const params = new URLSearchParams({
    page: String(input.page ?? 1),
    take: String(input.take ?? 50),
  });
  const search = input.search?.trim();
  if (search) params.set("search", search);
  return `/api/admin/users?${params}`;
}

async function fetchJson(path: string, fallbackMessage: string, fetcher: Fetcher) {
  const response = await fetcher(path, { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new AdminFetchError(result.error ?? fallbackMessage, response.status);
  return result;
}

export async function loadAdminSection(section: AdminSection, fetcher: Fetcher = fetch): Promise<Record<string, unknown>> {
  if (section === "workbench") return {};
  if (section === "overview") return { dashboard: await fetchJson("/api/admin/dashboard", "后台概览加载失败", fetcher) };
  if (section === "settings") return {};
  if (section === "videos") {
    const [reviews, videos, appeals] = await Promise.all([
      fetchJson("/api/reviewer/video-reviews?take=50", "二次审核池加载失败", fetcher),
      fetchJson("/api/admin/videos?take=50", "视频记录加载失败", fetcher),
      fetchJson("/api/admin/video-appeals?take=50", "申诉记录加载失败", fetcher),
    ]);
    return { reviews, appeals, videos };
  }
  if (section === "users") return { users: await fetchJson(buildAdminUsersPath(), "成员列表加载失败", fetcher) };
  if (section === "points") {
    const [users, points, pointRules] = await Promise.all([
      fetchJson(buildAdminUsersPath(), "成员列表加载失败", fetcher),
      fetchJson("/api/admin/points?take=50", "积分流水加载失败", fetcher),
      fetchJson("/api/admin/point-rules", "积分规则加载失败", fetcher),
    ]);
    return { users, points, pointRules };
  }
  if (section === "gifts") {
    const [gifts, orders] = await Promise.all([
      fetchJson("/api/admin/gifts", "礼品列表加载失败", fetcher),
      fetchJson("/api/admin/orders?take=50", "兑换订单加载失败", fetcher),
    ]);
    return { gifts, orders };
  }
  if (section === "orders") return { orders: await fetchJson("/api/admin/orders?take=50", "兑换订单加载失败", fetcher) };
  if (section === "rankings") return { rankings: await fetchJson("/api/admin/rankings", "榜单周期加载失败", fetcher) };
  if (section === "challenges") return { weeklyChallenges: await fetchJson("/api/admin/weekly-challenges?take=10", "周挑战加载失败", fetcher) };
  if (section === "announcements") {
    const [announcements, users] = await Promise.all([
      fetchJson("/api/admin/announcements?take=50", "公告加载失败", fetcher),
      fetchJson(buildAdminUsersPath(), "成员列表加载失败", fetcher),
    ]);
    return { announcements, users };
  }
  return { audit: await fetchJson("/api/admin/audit-logs?take=50", "审计日志加载失败", fetcher) };
}

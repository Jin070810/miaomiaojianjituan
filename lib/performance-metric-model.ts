export const API_METRICS = {
  auth_login_post: "登录", me_get: "成员身份", home_get: "成员首页", gifts_get: "礼品列表",
  growth_get: "成长档案", achievements_get: "成就详情", rankings_get: "排行榜", weekly_get: "周挑战",
  videos_get: "视频列表", videos_post: "提交视频", transfers_post: "积分转账",
  redemptions_get: "兑换记录", redemptions_post: "提交兑换", admin_dashboard_get: "管理概览",
} as const;
export type ApiMetric = keyof typeof API_METRICS;
export const RUM_NAMES = ["TTFB", "FCP", "LCP", "INP", "CLS"] as const;
export const PAGE_KINDS = ["login", "member", "admin", "other"] as const;
export const VIEWPORTS = ["mobile", "desktop"] as const;
export type RumPayload = { name: typeof RUM_NAMES[number]; page: typeof PAGE_KINDS[number]; viewport: typeof VIEWPORTS[number]; value: number };
export const QUEUE_METRICS = { video_queue_age: "视频入队至本次开始", weekly_queue_age: "周挑战入队至本次开始" } as const;
const DATABASE_METRICS = { db_read: "数据库 SELECT", db_write: "数据库写查询", db_other: "数据库其他查询" } as const;
const API_BOUNDS = [50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000, Infinity];
const RUM_BOUNDS = [100, 250, 500, 1000, 1800, 2500, 4000, 8000, 15000, 30000, 60000, Infinity];
const CLS_BOUNDS = [0.05, 0.1, 0.15, 0.25, 0.5, 1, 2, Infinity];
const QUEUE_BOUNDS = [1000, 5000, 15000, 30000, 60000, 120000, 300000, 600000, 1800000, 3600000, Infinity];
export function validateRum(value: unknown): RumPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 4 || !Object.keys(row).every((key) => ["name", "page", "viewport", "value"].includes(key))) return null;
  if (!(RUM_NAMES as readonly unknown[]).includes(row.name) || !(PAGE_KINDS as readonly unknown[]).includes(row.page) || !(VIEWPORTS as readonly unknown[]).includes(row.viewport)) return null;
  if (typeof row.value !== "number" || !Number.isFinite(row.value) || row.value < 0 || row.value > (row.name === "CLS" ? 100 : 600000)) return null;
  return row as RumPayload;
}
export function metricDefinition(key: string) {
  if (Object.hasOwn(DATABASE_METRICS, key)) return { kind: "database" as const, label: DATABASE_METRICS[key as keyof typeof DATABASE_METRICS], bounds: API_BOUNDS, unit: "ms" };
  if (Object.hasOwn(API_METRICS, key)) return { kind: "api" as const, label: API_METRICS[key as ApiMetric], bounds: API_BOUNDS, unit: "ms" };
  if (Object.hasOwn(QUEUE_METRICS, key)) return { kind: "queue" as const, label: QUEUE_METRICS[key as keyof typeof QUEUE_METRICS], bounds: QUEUE_BOUNDS, unit: "ms" };
  const [prefix, name, page, viewport, extra] = key.split(".");
  const rum = prefix === "rum" && !extra ? validateRum({ name, page, viewport, value: 0 }) : null;
  if (!rum) return null;
  return { kind: "rum" as const, label: name + " · " + ({ login: "登录页", member: "成员页", admin: "管理页", other: "其他页" }[rum.page]) + " · " + (viewport === "mobile" ? "移动端" : "桌面端"), bounds: name === "CLS" ? CLS_BOUNDS : RUM_BOUNDS, unit: name === "CLS" ? "" : "ms" };
}
export function bucketIndex(value: number, bounds: number[]) { return bounds.findIndex((upper) => value <= upper); }
export type PercentileInterval = { lower: number; upper: number | null };
export function summarizeHistogram(buckets: number[], bounds: number[], sum: number, errors: number) {
  const count = buckets.reduce((total, n) => total + n, 0);
  function percentile(fraction: number): PercentileInterval | null {
    if (!count) return null;
    const target = Math.ceil(count * fraction);
    let seen = 0;
    for (let i = 0; i < buckets.length; i++) {
      seen += buckets[i];
      if (seen >= target) return { lower: i === 0 ? 0 : bounds[i - 1], upper: Number.isFinite(bounds[i]) ? bounds[i] : null };
    }
    return null;
  }
  return { count, mean: count ? sum / count : null, errorRate: count ? errors / count : null, p50: percentile(0.5), p75: percentile(0.75), p95: percentile(0.95) };
}
export type PerformanceRow = ReturnType<typeof summarizeHistogram> & { key: string; kind: "api" | "rum" | "queue" | "database"; label: string; unit: string };

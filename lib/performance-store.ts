import Redis from "ioredis";
import { statfs } from "node:fs/promises";
import { QUEUE_SNAPSHOT_LUA, parseQueueSnapshot } from "./performance-queue";
import { bucketIndex, metricDefinition, summarizeHistogram, type PerformanceRow, type RumPayload } from "./performance-metric-model";

const PREFIX = "miaomiao:performance:v1:";
const HOUR = 3600000;
let redis: Redis | null = null;
let connecting: Promise<void> | null = null;
let unavailableUntil = 0;
let inFlight = 0;
let dropped = 0;
let idleClose: ReturnType<typeof setTimeout> | null = null;
// Independent connection: telemetry never consumes the business queue's retry budget.
async function withStore<T>(work: (client: Redis) => Promise<T>): Promise<T | null> {
  if (!process.env.REDIS_URL || Date.now() < unavailableUntil || inFlight >= 8) { dropped++; return null; }
  inFlight++;
  if (idleClose) { clearTimeout(idleClose); idleClose = null; }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let current: Redis | null = null;
  try {
    if (!redis) {
      const created = new Redis(process.env.REDIS_URL, {
        lazyConnect: true, connectTimeout: 350, commandTimeout: 350,
        maxRetriesPerRequest: 0, enableOfflineQueue: false, retryStrategy: () => null,
      }).on("error", () => undefined);
      redis = created;
      connecting = created.connect();
    }
    current = redis;
    const connection = current;
    return await Promise.race([
      (async () => {
        if (connecting) await connecting;
        if (connection.status !== "ready") throw new Error("telemetry-not-ready");
        return work(connection);
      })(),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("telemetry-timeout")), 800); }),
    ]);
  } catch {
    dropped++;
    unavailableUntil = Date.now() + 30000;
    if (redis === current) { redis = null; connecting = null; current?.disconnect(); }
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
    inFlight--;
    // Prisma is also used by short-lived CLIs. Do not leave an idle telemetry
    // connection keeping those processes alive; use only public Redis APIs.
    if (inFlight === 0 && redis) {
      const idleClient = redis;
      idleClose = setTimeout(() => {
        if (inFlight === 0 && redis === idleClient) {
          idleClient.disconnect(); redis = null; connecting = null;
        }
        idleClose = null;
      }, 1000);
      idleClose.unref();
    }
  }
}
export async function recordPerformance(key: string, value: number, failed = false) {
  const definition = metricDefinition(key);
  if (!definition || !Number.isFinite(value) || value < 0) return false;
  const safeValue = Math.min(value, definition.kind === "queue" ? 7 * 86400000 : definition.unit === "" ? 100 : 600000);
  return (await withStore(async (client) => {
    const redisKey = PREFIX + "hour:" + Math.floor(Date.now() / HOUR);
    const result = await client.multi()
      .hincrby(redisKey, key + ":b" + bucketIndex(safeValue, definition.bounds), 1)
      .hincrbyfloat(redisKey, key + ":sum", safeValue)
      .hincrby(redisKey, key + ":errors", failed ? 1 : 0)
      .expire(redisKey, 72 * 3600).exec();
    if (!result || result.some(([error]) => error)) throw new Error("telemetry-write-failed");
    return true;
  })) === true;
}
let rumMinute = -1;
let rumCount = 0;
export async function recordRum(payload: RumPayload) {
  const minute = Math.floor(Date.now() / 60000);
  if (minute !== rumMinute) { rumMinute = minute; rumCount = 0; }
  if (++rumCount > 3000) return false;
  const accepted = await withStore(async (client) => {
    const key = PREFIX + "rum-budget:" + minute;
    const count = await client.eval("local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 180) end; return n", 1, key);
    return Number(count) <= 3000;
  });
  return accepted === true && recordPerformance("rum." + payload.name + "." + payload.page + "." + payload.viewport, payload.value);
}
export type ResourceSnapshot = { at: string; role: "web" | "worker"; rssBytes: number; heapUsedBytes: number; uptimeSeconds: number; cpuPercent: number | null; diskAvailableBytes: number | null };
const resourcePrevious = new Map<string, { time: number; cpu: NodeJS.CpuUsage }>();
export async function recordProcessResources(role: "web" | "worker") {
  const now = performance.now();
  const previous = resourcePrevious.get(role);
  if (previous && now - previous.time < 15000) return;
  const cpu = process.cpuUsage();
  resourcePrevious.set(role, { time: now, cpu });
  const memory = process.memoryUsage();
  const disk = await statfs(process.cwd()).catch(() => null);
  const snapshot: ResourceSnapshot = {
    at: new Date().toISOString(), role, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed,
    uptimeSeconds: Math.floor(process.uptime()),
    diskAvailableBytes: disk ? disk.bavail * disk.bsize : null,
    cpuPercent: previous ? Math.max(0, ((cpu.user - previous.cpu.user) + (cpu.system - previous.cpu.system)) / ((now - previous.time) * 1000) * 100) : null,
  };
  await withStore(async (client) => client.set(PREFIX + "resource:" + role, JSON.stringify(snapshot), "EX", 60));
}
function parseResource(value: string | null, role: "web" | "worker"): ResourceSnapshot | null {
  if (!value || value.length > 1024) return null;
  try {
    const row = JSON.parse(value) as ResourceSnapshot;
    const age = Date.now() - Date.parse(row.at);
    if (row.role !== role || !Number.isFinite(age) || age < -5000 || age > 60000 || ![row.rssBytes, row.heapUsedBytes, row.uptimeSeconds].every((n) => Number.isFinite(n) && n >= 0) || (row.cpuPercent !== null && (!Number.isFinite(row.cpuPercent) || row.cpuPercent < 0))) return null;
    return { at: row.at, role, rssBytes: row.rssBytes, heapUsedBytes: row.heapUsedBytes, uptimeSeconds: row.uptimeSeconds, cpuPercent: row.cpuPercent, diskAvailableBytes: typeof row.diskAvailableBytes === "number" && Number.isFinite(row.diskAvailableBytes) && row.diskAvailableBytes >= 0 ? row.diskAvailableBytes : null };
  } catch { return null; }
}
export async function getPerformanceSnapshot() {
  const hour = Math.floor(Date.now() / HOUR);
  const result = await withStore(async (client) => {
    const pipeline = client.pipeline();
    for (let i = 23; i >= 0; i--) pipeline.hgetall(PREFIX + "hour:" + (hour - i));
    pipeline.get(PREFIX + "resource:web").get(PREFIX + "resource:worker");
    pipeline.eval(QUEUE_SNAPSHOT_LUA, 1, "bull:kuaishou-video:");
    pipeline.eval(QUEUE_SNAPSHOT_LUA, 1, "bull:weekly-challenges:");
    const replies = await pipeline.exec();
    if (!replies || replies.some(([error]) => error)) throw new Error("telemetry-read-failed");
    return replies;
  });
  const series = new Map<string, { buckets: number[]; sum: number; errors: number }>();
  if (result) for (const [, reply] of result.slice(0, 24)) {
    if (!reply || typeof reply !== "object") continue;
    for (const [field, value] of Object.entries(reply)) {
      const separator = field.lastIndexOf(":");
      const key = field.slice(0, separator);
      const suffix = field.slice(separator + 1);
      const definition = metricDefinition(key);
      const number = Number(value);
      if (!definition || !Number.isFinite(number) || number < 0) continue;
      const row = series.get(key) ?? { buckets: definition.bounds.map(() => 0), sum: 0, errors: 0 };
      if (suffix === "sum") row.sum += number;
      else if (suffix === "errors") row.errors += number;
      else if (/^b\d+$/.test(suffix) && Number(suffix.slice(1)) < row.buckets.length) row.buckets[Number(suffix.slice(1))] += number;
      else continue;
      series.set(key, row);
    }
  }
  const rows: PerformanceRow[] = Array.from(series, ([key, row]) => {
    const definition = metricDefinition(key)!;
    return { key, kind: definition.kind, label: definition.label, unit: definition.unit, ...summarizeHistogram(row.buckets, definition.bounds, row.sum, row.errors) };
  }).filter((row) => row.count > 0).sort((a, b) => b.count - a.count);
  return {
    status: result ? "ok" as const : process.env.REDIS_URL ? "unavailable" as const : "not-configured" as const,
    windowStart: new Date((hour - 23) * HOUR).toISOString(), windowEnd: new Date().toISOString(),
    rows, droppedInThisProcess: dropped,
    queues: { video: parseQueueSnapshot(result?.[26]?.[1]), weekly: parseQueueSnapshot(result?.[27]?.[1]) },
    resources: { web: parseResource(result?.[24]?.[1] as string | null, "web"), worker: parseResource(result?.[25]?.[1] as string | null, "worker") },
  };
}
export type PerformanceSnapshot = Awaited<ReturnType<typeof getPerformanceSnapshot>>;
export function closePerformanceStore() { if (idleClose) clearTimeout(idleClose); idleClose = null; redis?.disconnect(); redis = null; connecting = null; unavailableUntil = 0; }

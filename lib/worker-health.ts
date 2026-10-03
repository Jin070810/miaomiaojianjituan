import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import Redis from "ioredis";

const HEARTBEAT_KEY = "miaomiao:worker:heartbeat";
const HEARTBEAT_INDEX = "miaomiao:worker:instances";
const HEARTBEAT_TTL_SECONDS = 45;
const instanceId = process.env.HOSTNAME || hostname();
const ownerToken = randomUUID();
const instanceKey = `${HEARTBEAT_KEY}:${instanceId}`;
let redis: Redis | null = null;

export type WorkerHeartbeat = {
  status: "ok" | "missing" | "stale" | "not-configured" | "unavailable";
  commit: string | null;
  buildTime: string | null;
  heartbeatAt: string | null;
  instanceId?: string | null;
  state?: "running" | "draining";
};

function client() {
  if (!process.env.REDIS_URL) return null;
  return (redis ??= new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 3_000,
  }).on("error", () => undefined));
}

async function ready(current: Redis) {
  if (current.status === "ready") return;
  await new Promise<void>((resolve, reject) => {
    const onReady = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const timer = setTimeout(() => onError(new Error("Worker 心跳 Redis 连接超时")), 3_000);
    const cleanup = () => {
      clearTimeout(timer); current.off("ready", onReady); current.off("error", onError);
    };
    current.once("ready", onReady); current.once("error", onError);
  });
}

export async function writeWorkerHeartbeat(state: "running" | "draining" = "running") {
  const current = client();
  if (!current) return "not-configured" as const;
  await ready(current);
  const now = Date.now();
  const payload = JSON.stringify({
    heartbeatAt: new Date(now).toISOString(), instanceId, ownerToken, state,
    commit: process.env.APP_COMMIT_SHA?.trim() || null,
    buildTime: process.env.APP_BUILD_TIME?.trim() || null,
  });
  // Retain the legacy key during rolling upgrades. Every delete checks ownership.
  const results = await current.multi()
    .set(instanceKey, payload, "EX", HEARTBEAT_TTL_SECONDS)
    .zadd(HEARTBEAT_INDEX, now + HEARTBEAT_TTL_SECONDS * 1000, instanceKey)
    .zremrangebyscore(HEARTBEAT_INDEX, "-inf", now)
    .set(HEARTBEAT_KEY, payload, "EX", HEARTBEAT_TTL_SECONDS)
    .exec();
  const failure = results?.find(([error]) => error)?.[0];
  if (failure) throw failure;
}

function parseHeartbeat(value: string): WorkerHeartbeat {
  try {
    const parsed = JSON.parse(value) as {
      heartbeatAt?: string; commit?: string; buildTime?: string; instanceId?: string; state?: string;
    };
    const heartbeatAt = parsed.heartbeatAt ?? null;
    const age = heartbeatAt ? Date.now() - new Date(heartbeatAt).getTime() : Number.NaN;
    return {
      status: Number.isFinite(age) && age >= -5_000 && age <= HEARTBEAT_TTL_SECONDS * 1000 ? "ok" : "stale",
      commit: parsed.commit?.trim() || null, buildTime: parsed.buildTime?.trim() || null, heartbeatAt,
      instanceId: parsed.instanceId || null, state: parsed.state === "draining" ? "draining" : "running",
    };
  } catch {
    const age = Date.now() - new Date(value).getTime();
    return {
      status: Number.isFinite(age) && age >= -5_000 && age <= HEARTBEAT_TTL_SECONDS * 1000 ? "ok" : "stale",
      commit: null, buildTime: null, heartbeatAt: Number.isFinite(age) ? value : null,
    };
  }
}

export async function getWorkerHeartbeat(): Promise<WorkerHeartbeat> {
  const current = client();
  const empty = { commit: null, buildTime: null, heartbeatAt: null };
  if (!current) return { status: "not-configured", ...empty };
  await ready(current);
  const keys = await current.zrangebyscore(HEARTBEAT_INDEX, Date.now(), "+inf", "LIMIT", 0, 100);
  const values = keys.length ? await current.mget(...keys) : [];
  const legacy = await current.get(HEARTBEAT_KEY);
  if (legacy) values.push(legacy);
  const candidates = values.filter((value): value is string => Boolean(value)).map(parseHeartbeat);
  const expectedCommit = process.env.APP_COMMIT_SHA?.trim();
  candidates.sort((a, b) => {
    const score = (row: WorkerHeartbeat) =>
      (row.status === "ok" ? 4 : 0) + (expectedCommit && row.commit === expectedCommit ? 2 : 0) + (row.state !== "draining" ? 1 : 0);
    return score(b) - score(a) || (b.heartbeatAt ?? "").localeCompare(a.heartbeatAt ?? "");
  });
  return candidates[0] ?? { status: "missing", ...empty };
}

export async function checkWorkerHeartbeat() { return (await getWorkerHeartbeat()).status; }

export async function closeWorkerHealthConnection() {
  const current = redis;
  redis = null;
  if (current) await current.quit().catch(() => current.disconnect());
}

export async function closeWorkerHealth() {
  const current = redis;
  if (!current) return;
  // A draining old instance must not delete a replacement instance's heartbeat.
  await current.eval(`
    local function owned(key)
      local value = redis.call('GET', key)
      if not value then return false end
      local ok, parsed = pcall(cjson.decode, value)
      return ok and type(parsed) == 'table' and parsed.ownerToken == ARGV[1]
    end
    if owned(KEYS[1]) then
      redis.call('DEL', KEYS[1])
      redis.call('ZREM', KEYS[3], KEYS[1])
    end
    if owned(KEYS[2]) then redis.call('DEL', KEYS[2]) end
    return 1
  `, 3, instanceKey, HEARTBEAT_KEY, HEARTBEAT_INDEX, ownerToken).catch(() => undefined);
  await closeWorkerHealthConnection();
}

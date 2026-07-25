import Redis from "ioredis";

const HEARTBEAT_KEY = "miaomiao:worker:heartbeat";
const HEARTBEAT_TTL_SECONDS = 45;
let redis: Redis | null = null;

export type WorkerHeartbeat = {
  status: "ok" | "missing" | "stale" | "not-configured" | "unavailable";
  commit: string | null;
  buildTime: string | null;
  heartbeatAt: string | null;
};

function client() {
  if (!process.env.REDIS_URL) return null;
  return (redis ??= new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 3_000,
  }).on("error", () => undefined));
}

async function ready(current: Redis) {
  if (current.status === "ready") return;
  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      current.off("ready", onReady);
      current.off("error", onError);
    };
    current.once("ready", onReady);
    current.once("error", onError);
  });
}

export async function writeWorkerHeartbeat() {
  const current = client();
  if (!current) return "not-configured" as const;
  await ready(current);
  await current.set(HEARTBEAT_KEY, JSON.stringify({
    heartbeatAt: new Date().toISOString(),
    commit: process.env.APP_COMMIT_SHA?.trim() || null,
    buildTime: process.env.APP_BUILD_TIME?.trim() || null,
  }), "EX", HEARTBEAT_TTL_SECONDS);
  return "ok" as const;
}

export async function getWorkerHeartbeat(): Promise<WorkerHeartbeat> {
  const current = client();
  if (!current) return { status: "not-configured", commit: null, buildTime: null, heartbeatAt: null };
  await ready(current);
  const value = await current.get(HEARTBEAT_KEY);
  if (!value) return { status: "missing", commit: null, buildTime: null, heartbeatAt: null };
  try {
    const parsed = JSON.parse(value) as { heartbeatAt?: string; commit?: string | null; buildTime?: string | null };
    const heartbeatAt = parsed.heartbeatAt ?? null;
    const age = heartbeatAt ? Date.now() - new Date(heartbeatAt).getTime() : Number.NaN;
    return {
      status: Number.isFinite(age) && age <= HEARTBEAT_TTL_SECONDS * 1_000 ? "ok" : "stale",
      commit: parsed.commit?.trim() || null,
      buildTime: parsed.buildTime?.trim() || null,
      heartbeatAt,
    };
  } catch {
    const age = Date.now() - new Date(value).getTime();
    return {
      status: Number.isFinite(age) && age <= HEARTBEAT_TTL_SECONDS * 1_000 ? "ok" : "stale",
      commit: null,
      buildTime: null,
      heartbeatAt: Number.isFinite(age) ? value : null,
    };
  }
}

export async function checkWorkerHeartbeat() {
  return (await getWorkerHeartbeat()).status;
}

export async function closeWorkerHealth() {
  if (!redis) return;
  await redis.del(HEARTBEAT_KEY).catch(() => undefined);
  await redis.quit().catch(() => redis?.disconnect());
  redis = null;
}

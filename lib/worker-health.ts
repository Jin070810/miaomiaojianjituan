import Redis from "ioredis";

const HEARTBEAT_KEY = "miaomiao:worker:heartbeat";
const HEARTBEAT_TTL_SECONDS = 45;
let redis: Redis | null = null;

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
  await current.set(HEARTBEAT_KEY, new Date().toISOString(), "EX", HEARTBEAT_TTL_SECONDS);
  return "ok" as const;
}

export async function checkWorkerHeartbeat() {
  const current = client();
  if (!current) return "not-configured" as const;
  await ready(current);
  const value = await current.get(HEARTBEAT_KEY);
  if (!value) return "missing" as const;
  const age = Date.now() - new Date(value).getTime();
  return Number.isFinite(age) && age <= HEARTBEAT_TTL_SECONDS * 1_000 ? "ok" as const : "stale" as const;
}

export async function closeWorkerHealth() {
  if (!redis) return;
  await redis.quit().catch(() => redis?.disconnect());
  redis = null;
}

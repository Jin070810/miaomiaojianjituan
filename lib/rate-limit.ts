import Redis from "ioredis";

let redis: Redis | null = null;
const local = new Map<string, { count: number; resetAt: number }>();

function getRedis() {
  if (!process.env.REDIS_URL) return null;
  return (redis ??= new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true,
    connectTimeout: 3_000,
  }).on("error", () => undefined));
}

export async function checkRateLimitStore() {
  const client = getRedis();
  if (!client) return "not-configured" as const;
  await client.ping();
  return "ok" as const;
}

export async function closeRateLimitStore() {
  const current = redis;
  redis = null;
  if (!current) return;
  await current.quit().catch(() => current.disconnect());
}

export class RateLimitError extends Error {
  retryAfter: number;
  constructor(retryAfter: number) {
    super("操作过于频繁，请稍后再试");
    this.retryAfter = retryAfter;
  }
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  const client = getRedis();
  if (client) {
    const redisKey = `miaomiao:rate:${key}`;
    const count = await client.incr(redisKey);
    if (count === 1) await client.expire(redisKey, windowSeconds);
    if (count > limit) {
      const ttl = Math.max(1, await client.ttl(redisKey));
      throw new RateLimitError(ttl);
    }
    return;
  }

  const now = Date.now();
  const current = local.get(key);
  if (!current || current.resetAt <= now) {
    local.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return;
  }
  current.count += 1;
  if (current.count > limit) throw new RateLimitError(Math.ceil((current.resetAt - now) / 1000));
}

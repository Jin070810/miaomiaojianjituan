// Worker 容器健康检查：读取 Redis 心跳 key，心跳缺失或超过 TTL（45 秒）视为不健康，
// 由 Docker restart: unless-stopped 触发自愈。仅依赖 worker 镜像自带的 ioredis。
const { Redis } = require("ioredis");

const HEARTBEAT_KEY = "miaomiao:worker:heartbeat";
const HEARTBEAT_TTL_SECONDS = 45;
const TIMEOUT_MS = 8_000;

const timer = setTimeout(() => process.exit(1), TIMEOUT_MS);
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: 1,
  connectTimeout: 3_000,
});
redis.on("error", () => undefined);

redis.get(HEARTBEAT_KEY)
  .then((value) => {
    if (!value) process.exit(1);
    const parsed = JSON.parse(value);
    const age = Date.now() - new Date(parsed.heartbeatAt).getTime();
    process.exit(Number.isFinite(age) && age <= HEARTBEAT_TTL_SECONDS * 1_000 ? 0 : 1);
  })
  .catch(() => process.exit(1))
  .finally(() => {
    clearTimeout(timer);
    redis.disconnect();
  });

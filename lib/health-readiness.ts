import { db } from "./db";
import { runtimeConfigIssues } from "./config";
import { checkRateLimitStore } from "./rate-limit";
import { createHealthProbe, healthAppVersion } from "./health-probe";

const databaseProbe = createHealthProbe(async () => { await db.$queryRaw`SELECT 1`; return "ok" as const; }, "unavailable" as const);
const redisProbe = createHealthProbe(checkRateLimitStore, "unavailable" as const);

export async function getWebReadiness() {
  const [database, redis] = await Promise.all([databaseProbe(), redisProbe()]);
  const issues = [
    ...runtimeConfigIssues(),
    ...(database !== "ok" ? ["数据库不可用"] : []),
    ...(redis === "unavailable" || (process.env.NODE_ENV === "production" && redis !== "ok") ? ["Redis不可用"] : []),
  ];
  return { ok: issues.length === 0, app: healthAppVersion(), database, redis, issues, time: new Date().toISOString() };
}

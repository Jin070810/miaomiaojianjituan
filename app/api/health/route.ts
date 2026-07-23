import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runtimeConfigIssues } from "@/lib/config";
import { checkRateLimitStore } from "@/lib/rate-limit";
import { checkWorkerHeartbeat } from "@/lib/worker-health";

export async function GET() {
  const configIssues = runtimeConfigIssues();
  try {
    const [, redis, worker] = await Promise.all([
      db.$queryRaw`SELECT 1`,
      checkRateLimitStore().catch(() => "unavailable" as const),
      checkWorkerHeartbeat().catch(() => "unavailable" as const),
    ]);
    const admins = await db.user.count({ where: { role: "ADMIN", active: true } });
    const adminIssue = process.env.NODE_ENV === "production" && admins === 0 ? ["没有启用的管理员账号"] : [];
    const redisIssue = process.env.NODE_ENV === "production" && redis !== "ok" ? ["Redis不可用"] : [];
    const workerIssue = process.env.NODE_ENV === "production" && worker !== "ok" ? ["视频处理Worker不可用"] : [];
    const issues = [...configIssues, ...adminIssue, ...redisIssue, ...workerIssue];
    return NextResponse.json({
      ok: issues.length === 0,
      database: "ok",
      redis,
      worker,
      admins,
      issues,
      time: new Date().toISOString(),
    }, { status: issues.length === 0 ? 200 : 503 });
  } catch {
    return NextResponse.json({ ok: false, database: "unavailable", redis: "unknown", issues: configIssues }, { status: 503 });
  }
}

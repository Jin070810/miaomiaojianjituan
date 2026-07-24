import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runtimeConfigIssues } from "@/lib/config";
import { checkRateLimitStore } from "@/lib/rate-limit";
import { checkWorkerHeartbeat } from "@/lib/worker-health";
import { getVideoQueueMetrics } from "@/lib/video-jobs";

export async function GET() {
  const configIssues = runtimeConfigIssues();
  try {
    const [, redis, worker, queue] = await Promise.all([
      db.$queryRaw`SELECT 1`,
      checkRateLimitStore().catch(() => "unavailable" as const),
      checkWorkerHeartbeat().catch(() => "unavailable" as const),
      getVideoQueueMetrics().catch(() => null),
    ]);
    const admins = await db.user.count({ where: { role: "ADMIN", active: true } });
    const adminIssue = process.env.NODE_ENV === "production" && admins === 0 ? ["没有启用的管理员账号"] : [];
    const redisIssue = process.env.NODE_ENV === "production" && redis !== "ok" ? ["Redis不可用"] : [];
    const workerIssue = process.env.NODE_ENV === "production" && worker !== "ok" ? ["视频处理Worker不可用"] : [];
    const queueIssue = process.env.NODE_ENV === "production" && queue && queue.waiting > Number(process.env.QUEUE_WAITING_ALERT_THRESHOLD ?? 1000)
      ? ["视频队列等待任务过多"] : [];
    const issues = [...configIssues, ...adminIssue, ...redisIssue, ...workerIssue, ...queueIssue];
    return NextResponse.json({
      ok: issues.length === 0,
      database: "ok",
      redis,
      worker,
      queue,
      admins,
      issues,
      time: new Date().toISOString(),
    }, { status: issues.length === 0 ? 200 : 503 });
  } catch {
    return NextResponse.json({ ok: false, database: "unavailable", redis: "unknown", issues: configIssues }, { status: 503 });
  }
}

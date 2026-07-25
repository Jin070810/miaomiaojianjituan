import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runtimeConfigIssues } from "@/lib/config";
import { checkRateLimitStore } from "@/lib/rate-limit";
import { getWorkerHeartbeat } from "@/lib/worker-health";
import { getVideoQueueMetrics } from "@/lib/video-jobs";
import { weeklyChallengeSchedulerStatus } from "@/lib/weekly-challenges";

export async function GET() {
  const configIssues = runtimeConfigIssues();
  const app = {
    commit: process.env.APP_COMMIT_SHA?.trim() || null,
    buildTime: process.env.APP_BUILD_TIME?.trim() || null,
  };
  try {
    const [, redis, workerVersion, queue, weeklyChallenges] = await Promise.all([
      db.$queryRaw`SELECT 1`,
      checkRateLimitStore().catch(() => "unavailable" as const),
      getWorkerHeartbeat().catch(() => ({
        status: "unavailable" as const,
        commit: null,
        buildTime: null,
        heartbeatAt: null,
      })),
      getVideoQueueMetrics().catch(() => null),
      weeklyChallengeSchedulerStatus().catch(() => null),
    ]);
    const worker = workerVersion.status;
    const admins = await db.user.count({ where: { role: "ADMIN", active: true } });
    const adminIssue = process.env.NODE_ENV === "production" && admins === 0 ? ["没有启用的管理员账号"] : [];
    const redisIssue = process.env.NODE_ENV === "production" && redis !== "ok" ? ["Redis不可用"] : [];
    const workerIssue = process.env.NODE_ENV === "production" && worker !== "ok" ? ["视频处理Worker不可用"] : [];
    const versionIssue = process.env.NODE_ENV === "production"
      && workerVersion.commit !== process.env.APP_COMMIT_SHA
      ? ["App与Worker提交版本不一致"] : [];
    const weeklyChallengeIssue = process.env.NODE_ENV === "production" && weeklyChallenges?.enabled
      ? [
          ...(!weeklyChallenges.providerConfigured ? ["周挑战已启用但DeepSeek配置不完整"] : []),
          ...(!process.env.ALERT_WEBHOOK_URL?.trim() ? ["周挑战已启用但告警Webhook未配置"] : []),
        ]
      : [];
    const weeklyChallengeStatusIssue = process.env.NODE_ENV === "production" && !weeklyChallenges
      ? ["周挑战调度状态不可用"] : [];
    const queueIssue = process.env.NODE_ENV === "production" && queue && queue.waiting > Number(process.env.QUEUE_WAITING_ALERT_THRESHOLD ?? 1000)
      ? ["视频队列等待任务过多"] : [];
    const issues = [
      ...configIssues,
      ...adminIssue,
      ...redisIssue,
      ...workerIssue,
      ...versionIssue,
      ...weeklyChallengeIssue,
      ...weeklyChallengeStatusIssue,
      ...queueIssue,
    ];
    return NextResponse.json({
      ok: issues.length === 0,
      app,
      database: "ok",
      redis,
      worker,
      workerVersion,
      queue,
      weeklyChallenges,
      admins,
      issues,
      time: new Date().toISOString(),
    }, { status: issues.length === 0 ? 200 : 503 });
  } catch {
    const workerVersion = await getWorkerHeartbeat().catch(() => ({
      status: "unavailable" as const,
      commit: null,
      buildTime: null,
      heartbeatAt: null,
    }));
    return NextResponse.json({
      ok: false,
      app,
      database: "unavailable",
      redis: "unknown",
      worker: workerVersion.status,
      workerVersion,
      weeklyChallenges: null,
      issues: configIssues,
      time: new Date().toISOString(),
    }, { status: 503 });
  }
}

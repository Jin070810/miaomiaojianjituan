import { NextResponse } from "next/server";
import { operationalAlertConfigurationStatus } from "@/lib/alerts";
import { db } from "@/lib/db";
import { getWorkerHeartbeat, type WorkerHeartbeat } from "@/lib/worker-health";
import { getVideoQueueMetrics } from "@/lib/video-jobs";
import { weeklyChallengeSchedulerStatus } from "@/lib/weekly-challenges";
import { getWeeklyChallengeQueueStatus } from "@/lib/weekly-challenge-jobs";
import { getWebReadiness } from "@/lib/health-readiness";
import { createHealthProbe, healthHeaders } from "@/lib/health-probe";

export const dynamic = "force-dynamic";

const workerProbe = createHealthProbe<WorkerHeartbeat>(getWorkerHeartbeat, { status: "unavailable", commit: null, buildTime: null, heartbeatAt: null });
const videoQueueProbe = createHealthProbe(getVideoQueueMetrics, null, 2_000, 5_000);
const weeklyProbe = createHealthProbe<Awaited<ReturnType<typeof weeklyChallengeSchedulerStatus>> | null>(weeklyChallengeSchedulerStatus, null, 2_000, 5_000);
const weeklyQueueProbe = createHealthProbe<Awaited<ReturnType<typeof getWeeklyChallengeQueueStatus>> | null>(getWeeklyChallengeQueueStatus, null, 2_000, 5_000);
const adminProbe = createHealthProbe<number | null>(() => db.user.count({ where: { role: "ADMIN", active: true } }), null, 2_000, 5_000);

// Retain the detailed /api/health contract used by releases and operations.
// Container readiness uses /api/health/ready and never waits for Worker jobs.
export async function GET() {
  const [web, workerVersion, queue, weeklyChallenges, weeklyChallengeQueue, admins] = await Promise.all([
    getWebReadiness(), workerProbe(), videoQueueProbe(), weeklyProbe(), weeklyQueueProbe(), adminProbe(),
  ]);
  const production = process.env.NODE_ENV === "production";
  const worker = workerVersion.status;
  const issues = [
    ...web.issues,
    ...(production && admins === null ? ["管理员状态不可用"] : []),
    ...(production && admins === 0 ? ["没有启用的管理员账号"] : []),
    ...(production && worker !== "ok" ? ["视频处理Worker不可用"] : []),
    ...(production && workerVersion.commit !== web.app.commit ? ["App与Worker提交版本不一致"] : []),
    ...(production && !queue ? ["视频队列状态不可用"] : []),
    ...(production && queue && queue.waiting > Number(process.env.QUEUE_WAITING_ALERT_THRESHOLD ?? 1000) ? ["视频队列等待任务过多"] : []),
    ...(production && !weeklyChallenges ? ["周挑战调度状态不可用"] : []),
    ...(production && weeklyChallenges?.enabled ? [
      ...(!weeklyChallenges.providerConfigured ? ["周挑战已启用但DeepSeek配置不完整"] : []),
      ...(!operationalAlertConfigurationStatus().configured ? ["周挑战已启用但告警通道未配置"] : []),
      ...(!weeklyChallengeQueue?.schedulerConfigured ? ["周挑战持久化调度器不可用"] : []),
    ] : []),
  ];
  const operationalIssues = weeklyChallenges?.operationalIssues ?? ["周挑战运行状态不可用"];
  return NextResponse.json({
    ...web, ok: issues.length === 0, degraded: operationalIssues.length > 0,
    worker, workerVersion, queue, weeklyChallenges, weeklyChallengeQueue, operationalIssues, admins, issues,
  }, { status: issues.length === 0 ? 200 : 503, headers: healthHeaders });
}

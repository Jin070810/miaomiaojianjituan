import { Worker } from "bullmq";
import "dotenv/config";
import { connection, processVideoSubmission, recoverStaleVideoSubmissions } from "./lib/video-jobs";
import { db } from "./lib/db";
import { closeWorkerHealth, writeWorkerHeartbeat } from "./lib/worker-health";
import { sendOperationalAlert } from "./lib/alerts";
import {
  generateWeeklyChallengePeriod,
  runWeeklyChallengeMaintenance,
} from "./lib/weekly-challenge-generation";
import { closeWeeklyChallengeQueue } from "./lib/weekly-challenge-jobs";
import { runMemberClearanceMaintenance } from "./lib/member-clearance";
import { runMemberGrowthMonthlyMaintenance } from "./lib/member-achievements";

const worker = new Worker("kuaishou-video", async (job) => {
  await processVideoSubmission(job.data.videoId);
}, {
  connection: connection(),
  concurrency: Math.min(12, Math.max(1, Number(process.env.VIDEO_WORKER_CONCURRENCY ?? 4))),
});

const weeklyChallengeWorker = new Worker("weekly-challenges", async (job) => {
  await generateWeeklyChallengePeriod({
    periodStart: new Date(job.data.periodStart),
    retryFailed: Boolean(job.data.retryFailed),
    allowLateGeneration: Boolean(job.data.allowLateGeneration),
  });
}, {
  connection: connection(),
  concurrency: 1,
});

worker.on("completed", (job) => console.log(`[video-worker] completed ${job.id}`));
worker.on("failed", (job, error) => {
  console.error(`[video-worker] failed ${job?.id}`, error);
  void sendOperationalAlert({ source: "video-worker", severity: "warning", message: "视频任务处理失败", details: { jobId: job?.id, error: error.message } });
});
worker.on("error", (error) => {
  console.error("[video-worker] redis error", error);
  void sendOperationalAlert({ source: "video-worker", severity: "critical", message: "视频 Worker 或 Redis 出错", details: { error: error.message } });
});
weeklyChallengeWorker.on("completed", (job) => console.log(`[weekly-challenge-worker] completed ${job.id}`));
weeklyChallengeWorker.on("failed", (job, error) => {
  console.error(`[weekly-challenge-worker] failed ${job?.id}`, error);
  void sendOperationalAlert({
    source: "weekly-challenge-worker",
    severity: "critical",
    message: "周挑战生成任务失败",
    details: { jobId: job?.id, error: error.message },
  });
});
weeklyChallengeWorker.on("error", (error) => {
  console.error("[weekly-challenge-worker] redis error", error);
});

let closing = false;
let maintenanceRunning = false;
let maintenanceTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

async function maintenance() {
  if (closing || maintenanceRunning) return;
  maintenanceRunning = true;
  try {
    const [recovery] = await Promise.all([
      recoverStaleVideoSubmissions(),
      db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
      runWeeklyChallengeMaintenance(),
      runMemberClearanceMaintenance(),
      runMemberGrowthMonthlyMaintenance(),
    ]);
    if (recovery.found > 0) {
      console.log(`[video-worker] recovery scanned=${recovery.found} enqueued=${recovery.enqueued}`);
    }
  } catch (error) {
    console.error("[worker-maintenance] failed", error);
    await sendOperationalAlert({ source: "video-worker", severity: "warning", message: "Worker 维护任务失败", details: { error: error instanceof Error ? error.message : String(error) } });
  } finally {
    maintenanceRunning = false;
  }
}

async function heartbeat() {
  if (closing) return;
  try {
    await writeWorkerHeartbeat();
  } catch (error) {
    console.error("[video-worker] heartbeat failed", error);
  }
}

async function start() {
  await Promise.all([worker.waitUntilReady(), weeklyChallengeWorker.waitUntilReady()]);
  console.log("[video-worker] listening");
  await Promise.all([maintenance(), heartbeat()]);
  maintenanceTimer = setInterval(() => void maintenance(), 60_000);
  heartbeatTimer = setInterval(() => void heartbeat(), 15_000);
}

async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`[video-worker] ${signal} received, shutting down`);
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  await Promise.allSettled([
    worker.close(),
    weeklyChallengeWorker.close(),
    closeWeeklyChallengeQueue(),
    closeWorkerHealth(),
    db.$disconnect(),
  ]);
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

void start().catch(async (error) => {
  console.error("[video-worker] startup failed", error);
  await sendOperationalAlert({ source: "video-worker", severity: "critical", message: "视频 Worker 启动失败", details: { error: error instanceof Error ? error.message : String(error) } });
  await shutdown("startup-failure");
  process.exitCode = 1;
});

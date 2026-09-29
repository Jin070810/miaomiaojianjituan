import { Worker } from "bullmq";
import "dotenv/config";
import { closeDouyinBrowser, connection, processVideoSubmission, recoverStaleVideoSubmissions } from "./lib/video-jobs";
import { db } from "./lib/db";
import { closeWorkerHealth, writeWorkerHeartbeat } from "./lib/worker-health";
import { sendOperationalAlert } from "./lib/alerts";
import {
  generateWeeklyChallengePeriod,
  runWeeklyChallengeMaintenance,
} from "./lib/weekly-challenge-generation";
import {
  closeWeeklyChallengeQueue,
  enqueueWeeklyChallengeGeneration,
  ensureWeeklyChallengeScheduler,
} from "./lib/weekly-challenge-jobs";
import { runMemberClearanceMaintenance } from "./lib/member-clearance";
import { getMemberClearanceOperationalSnapshot, memberClearanceOperationalIssues } from "./lib/member-clearance-operations";
import { runMemberGrowthMonthlyMaintenance } from "./lib/member-achievements";
import { runBirthdayMaintenance } from "./lib/birthdays";

const worker = new Worker("kuaishou-video", async (job) => {
  await processVideoSubmission(job.data.videoId);
}, {
  connection: connection(),
  concurrency: Math.min(12, Math.max(1, Number(process.env.VIDEO_WORKER_CONCURRENCY ?? 4))),
});

const weeklyChallengeWorker = new Worker("weekly-challenges", async (job) => {
  if (job.name === "scheduled-generate") {
    const maintenance = await runWeeklyChallengeMaintenance();
    if (!maintenance.generationDue || !maintenance.periodStart) return;
    await generateWeeklyChallengePeriod({
      periodStart: maintenance.periodStart,
      retryFailed: true,
      // 调度器周日触发、任务周一才被消费时，同样允许迟到补跑。
      allowLateGeneration: maintenance.late === true,
    });
    return;
  }
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
    const [recovery, , challengeMaintenance, clearanceMaintenance] = await Promise.all([
      recoverStaleVideoSubmissions(),
      db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
      runWeeklyChallengeMaintenance(),
      runMemberClearanceMaintenance(),
      runMemberGrowthMonthlyMaintenance(),
      runBirthdayMaintenance(),
    ]);
    if (challengeMaintenance.generationDue && challengeMaintenance.periodStart) {
      const enqueued = await enqueueWeeklyChallengeGeneration(
        challengeMaintenance.periodStart,
        true,
        challengeMaintenance.late === true,
      );
      if (!enqueued.reused && challengeMaintenance.late) {
        await sendOperationalAlert({
          source: "weekly-challenge-worker",
          severity: "warning",
          message: "周挑战错过周日生成窗口，已按迟到补跑重新入队",
          details: { periodStart: challengeMaintenance.periodStart.toISOString() },
        });
      }
    }
    if (recovery.found > 0) {
      console.log(`[video-worker] recovery scanned=${recovery.found} enqueued=${recovery.enqueued}`);
    }
    if (clearanceMaintenance.initialized || clearanceMaintenance.warned || clearanceMaintenance.cleared || clearanceMaintenance.failed) {
      console.log("[member-clearance] maintenance", JSON.stringify({
        initialized: clearanceMaintenance.initialized,
        scanned: clearanceMaintenance.scanned,
        warned: clearanceMaintenance.warned,
        cleared: clearanceMaintenance.cleared,
        failed: clearanceMaintenance.failed,
      }));
    }
    if (clearanceMaintenance.failed) {
      await sendOperationalAlert({
        source: "member-clearance",
        severity: "warning",
        message: "成员清退维护存在单条失败",
        details: { failed: clearanceMaintenance.failed, failures: clearanceMaintenance.failures.slice(0, 20) },
      });
    }
    if (clearanceMaintenance.cleared) {
      const snapshot = await getMemberClearanceOperationalSnapshot();
      const issues = memberClearanceOperationalIssues(snapshot);
      if (issues.length) {
        await sendOperationalAlert({
          source: "member-clearance",
          severity: "critical",
          message: "成员清退后数据核对失败",
          details: { snapshot, issues },
        });
      }
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
  await ensureWeeklyChallengeScheduler();
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
    closeDouyinBrowser(),
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

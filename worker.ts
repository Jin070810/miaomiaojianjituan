import { DelayedError, Worker } from "bullmq";
import "dotenv/config";
import { closeDouyinBrowser, closeVideoQueue, connection, processVideoSubmission } from "./lib/video-jobs";
import { db } from "./lib/db";
import { closeWorkerHealth, writeWorkerHeartbeat } from "./lib/worker-health";
import { sendOperationalAlert } from "./lib/alerts";
import { runWorkerMaintenanceCycle } from "./lib/worker-maintenance";
import {
  generateWeeklyChallengePeriod,
  runWeeklyChallengeMaintenance,
} from "./lib/weekly-challenge-generation";
import {
  closeWeeklyChallengeQueue,
  enqueueWeeklyChallengeGeneration,
  ensureWeeklyChallengeScheduler,
} from "./lib/weekly-challenge-jobs";
import { getMemberClearanceOperationalSnapshot, memberClearanceOperationalIssues } from "./lib/member-clearance-operations";
import { VideoProcessingDeferredError } from "./lib/video-processing";

// Independent of Redis/DB health; the parent can detect an event-loop stall.
const watchdogTimer = process.env.MIAOMIAO_WORKER_SUPERVISED === "1" && process.send
  ? setInterval(() => { if (process.connected) process.send?.({ type: "worker-liveness" }); }, 10_000)
  : null;
watchdogTimer?.unref();

const worker = new Worker("kuaishou-video", async (job, token) => {
  try {
    await processVideoSubmission(job.data.videoId, {
      finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
    });
  } catch (error) {
    if (error instanceof VideoProcessingDeferredError) {
      await job.moveToDelayed(Math.max(Date.now() + 100, error.retryAt.getTime()), token);
      throw new DelayedError();
    }
    throw error;
  }
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
  // 与视频 Worker 对齐上报；重复错误的频率由 lib/alerts 的冷却窗口控制。
  void sendOperationalAlert({ source: "weekly-challenge-worker", severity: "critical", message: "周挑战 Worker 或 Redis 出错", details: { error: error.message } });
});

let closing = false;
let maintenanceRunning = false;
let maintenanceTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let heartbeatRunning = false;
let activeMaintenance: Promise<void> | null = null;
let activeHeartbeat: Promise<void> | null = null;

function startMaintenance() {
  if (closing || maintenanceRunning) return;
  const task = maintenance().catch((error) => console.error("[worker-maintenance] alert failed", error));
  activeMaintenance = task;
  void task.finally(() => { if (activeMaintenance === task) activeMaintenance = null; });
}

async function maintenance() {
  if (closing || maintenanceRunning) return;
  maintenanceRunning = true;
  try {
    const cycle = await runWorkerMaintenanceCycle();
    const challengeMaintenance = cycle.challengeMaintenance;
    if (challengeMaintenance?.generationDue && challengeMaintenance.periodStart) {
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
    if (cycle.recovery && cycle.recovery.found > 0) {
      console.log(`[video-worker] recovery scanned=${cycle.recovery.found} enqueued=${cycle.recovery.enqueued}`);
    }
    const clearanceMaintenance = cycle.clearanceMaintenance;
    if (clearanceMaintenance) {
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
    }
    if (cycle.failures.length) {
      await sendOperationalAlert({
        source: "video-worker",
        severity: "warning",
        message: "Worker 维护循环存在失败任务",
        details: { failures: cycle.failures },
      });
    }
  } catch (error) {
    console.error("[worker-maintenance] failed", error);
    await sendOperationalAlert({ source: "video-worker", severity: "warning", message: "Worker 维护任务失败", details: { error: error instanceof Error ? error.message : String(error) } });
  } finally {
    maintenanceRunning = false;
  }
}

async function heartbeat() {
  if (heartbeatRunning) return;
  heartbeatRunning = true;
  try {
    await writeWorkerHeartbeat(closing ? "draining" : "running");
  } catch (error) {
    console.error("[video-worker] heartbeat failed", error);
  } finally {
    heartbeatRunning = false;
  }
}

function startHeartbeat() {
  if (activeHeartbeat) return activeHeartbeat;
  const task = heartbeat();
  activeHeartbeat = task;
  void task.finally(() => { if (activeHeartbeat === task) activeHeartbeat = null; });
  return task;
}

async function start() {
  await ensureWeeklyChallengeScheduler();
  await Promise.all([worker.waitUntilReady(), weeklyChallengeWorker.waitUntilReady()]);
  console.log("[video-worker] listening");
  await startHeartbeat();
  heartbeatTimer = setInterval(() => void startHeartbeat(), 15_000);
  maintenanceTimer = setInterval(startMaintenance, 60_000);
  startMaintenance();
}

async function shutdown(signal: string, exitCode = 0) {
  if (closing) return;
  closing = true;
  console.log(`[video-worker] ${signal} received, shutting down`);
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  // 先等队列任务排空，再清除心跳：滚动发布期间健康检查不应在活跃任务尚未
  // 完成时就把 Worker 判死。
  await Promise.allSettled([worker.close(), weeklyChallengeWorker.close(), activeMaintenance]);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  // Finish the last write before deleting this instance's keys.
  await activeHeartbeat;
  await Promise.allSettled([
    closeVideoQueue(),
    closeWeeklyChallengeQueue(),
    closeWorkerHealth(),
    closeDouyinBrowser(),
    db.$disconnect(),
  ]);
  if (watchdogTimer) clearInterval(watchdogTimer);
  process.exit(exitCode);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

void start().catch(async (error) => {
  console.error("[video-worker] startup failed", error);
  await sendOperationalAlert({ source: "video-worker", severity: "critical", message: "视频 Worker 启动失败", details: { error: error instanceof Error ? error.message : String(error) } });
  await shutdown("startup-failure", 1);
});

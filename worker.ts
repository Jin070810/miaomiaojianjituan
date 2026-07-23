import { Worker } from "bullmq";
import "dotenv/config";
import { connection, processVideoSubmission, recoverStaleVideoSubmissions } from "./lib/video-jobs";
import { settleDueRankings } from "./lib/rankings";
import { db } from "./lib/db";
import { closeWorkerHealth, writeWorkerHeartbeat } from "./lib/worker-health";

const worker = new Worker("kuaishou-video", async (job) => {
  await processVideoSubmission(job.data.videoId);
}, {
  connection: connection(),
  concurrency: Math.min(12, Math.max(1, Number(process.env.VIDEO_WORKER_CONCURRENCY ?? 4))),
});

worker.on("completed", (job) => console.log(`[video-worker] completed ${job.id}`));
worker.on("failed", (job, error) => console.error(`[video-worker] failed ${job?.id}`, error));
worker.on("error", (error) => console.error("[video-worker] redis error", error));

let closing = false;
let maintenanceTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

async function maintenance() {
  if (closing) return;
  try {
    const [recovery] = await Promise.all([
      recoverStaleVideoSubmissions(),
      settleDueRankings(),
      db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    ]);
    if (recovery.found > 0) {
      console.log(`[video-worker] recovery scanned=${recovery.found} enqueued=${recovery.enqueued}`);
    }
  } catch (error) {
    console.error("[worker-maintenance] failed", error);
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
  await worker.waitUntilReady();
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
    closeWorkerHealth(),
    db.$disconnect(),
  ]);
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

void start().catch(async (error) => {
  console.error("[video-worker] startup failed", error);
  await shutdown("startup-failure");
  process.exitCode = 1;
});

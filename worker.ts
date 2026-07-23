import { Worker } from "bullmq";
import "dotenv/config";
import { connection, processVideoSubmission } from "./lib/video-jobs";
import { settleDueRankings } from "./lib/rankings";
import { db } from "./lib/db";

const worker = new Worker("kuaishou-video", async (job) => {
  await processVideoSubmission(job.data.videoId);
}, {
  connection: connection(),
  concurrency: Math.min(12, Math.max(1, Number(process.env.VIDEO_WORKER_CONCURRENCY ?? 4))),
});

worker.on("completed", (job) => console.log(`[video-worker] completed ${job.id}`));
worker.on("failed", (job, error) => console.error(`[video-worker] failed ${job?.id}`, error));
console.log("[video-worker] listening");

async function settle() {
  try {
    await settleDueRankings();
    await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch (error) {
    console.error("[ranking-worker] settlement failed", error);
  }
}

void settle();
setInterval(() => void settle(), 60_000);

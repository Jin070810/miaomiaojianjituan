import { Queue } from "bullmq";
import { connection } from "./video-jobs";

let queue: Queue | null = null;

function getQueue() {
  return (queue ??= new Queue("weekly-challenges", { connection: connection() }));
}

export async function enqueueWeeklyChallengeGeneration(periodStart: Date, retryFailed = false) {
  const jobId = `weekly-challenge-${periodStart.toISOString().slice(0, 10)}-${retryFailed ? "retry" : "generate"}`;
  const challengeQueue = getQueue();
  const existing = await challengeQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (["failed", "completed"].includes(state)) await existing.remove();
    else return existing;
  }
  return challengeQueue.add("generate", {
    periodStart: periodStart.toISOString(),
    retryFailed,
  }, {
    jobId,
    attempts: 1,
    removeOnComplete: 20,
    removeOnFail: 50,
  });
}

export async function closeWeeklyChallengeQueue() {
  if (!queue) return;
  await queue.close();
  queue = null;
}

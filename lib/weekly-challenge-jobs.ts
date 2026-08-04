import { Queue } from "bullmq";
import { connection } from "./video-jobs";

let queue: Queue | null = null;
const SCHEDULER_ID = "weekly-challenge-sunday-1800-shanghai-v1";

function getQueue() {
  return (queue ??= new Queue("weekly-challenges", { connection: connection() }));
}

export async function enqueueWeeklyChallengeGeneration(periodStart: Date, retryFailed = false, allowLateGeneration = false) {
  const jobId = `weekly-challenge-${periodStart.toISOString().slice(0, 10)}-${retryFailed ? "retry" : "generate"}${allowLateGeneration ? "-late" : ""}`;
  const challengeQueue = getQueue();
  const existing = await challengeQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (["failed", "completed"].includes(state)) await existing.remove();
    else return { job: existing, reused: true, state };
  }
  const job = await challengeQueue.add("generate", {
    periodStart: periodStart.toISOString(),
    retryFailed,
    allowLateGeneration,
  }, {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: 20,
    removeOnFail: 50,
  });
  return { job, reused: false, state: "waiting" };
}

export async function ensureWeeklyChallengeScheduler() {
  return getQueue().upsertJobScheduler(SCHEDULER_ID, {
    pattern: "0 18 * * 0",
    tz: "Asia/Shanghai",
  }, {
    name: "scheduled-generate",
    data: { trigger: "weekly-scheduler" },
    opts: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: 20,
      removeOnFail: 50,
    },
  });
}

export async function getWeeklyChallengeQueueStatus() {
  const challengeQueue = getQueue();
  const [counts, schedulers] = await Promise.all([
    challengeQueue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
    challengeQueue.getJobSchedulers(0, 10, true),
  ]);
  const scheduler = schedulers.find((entry) => entry.key === SCHEDULER_ID) ?? null;
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    completed: counts.completed ?? 0,
    schedulerConfigured: Boolean(scheduler),
    nextScheduledAt: scheduler?.next ?? null,
  };
}

export async function closeWeeklyChallengeQueue() {
  if (!queue) return;
  await queue.close();
  queue = null;
}

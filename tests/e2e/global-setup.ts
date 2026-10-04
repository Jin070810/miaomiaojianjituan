import { Queue } from "bullmq";
import { connection } from "@/lib/video-jobs";
import { assertIsolatedE2EServices, pauseFixtureQueue } from "../support/pause-fixture-queue";

export default async function setup() {
  assertIsolatedE2EServices(process.env);
  const queue = new Queue("weekly-challenges", { connection: connection() });
  try {
    const restore = await pauseFixtureQueue(queue);
    return async () => {
      try { await restore(); } finally { await queue.close(); }
    };
  } catch (error) {
    await queue.close();
    throw error;
  }
}

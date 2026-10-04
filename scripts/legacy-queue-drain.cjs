// Sent over stdin to Node in the identified container; never copied into an image.
const assert = require('node:assert/strict');
const { Queue } = require('bullmq');
const Redis = require('ioredis');

(async () => {
  assert.equal(process.cwd(), '/app');
  const action = process.env.LEGACY_QUEUE_ACTION;
  assert.ok(['inspect', 'pause', 'resume'].includes(action));
  if (action === 'pause') {
    assert.equal(process.env.APP_COMMIT_SHA, '752b084ec220ce5c827609611e51ce718b28b92d');
  }
  const names = ['kuaishou-video', 'weekly-challenges'];
  const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 5000 });
  const queues = names.map(name => new Queue(name, { connection }));
  const deadline = setTimeout(() => process.exit(1), 80_000);
  try {
    if (action === 'pause') await Promise.all(queues.map(queue => queue.pause()));
    if (action === 'resume') {
      const previous = JSON.parse(process.env.LEGACY_QUEUE_PREVIOUS);
      assert.deepEqual(previous.queues.map(queue => queue.name), names);
      assert.ok(previous.queues.every(queue => typeof queue.paused === 'boolean'));
      for (const [index, queue] of queues.entries()) {
        if (!previous.queues[index].paused) await queue.resume();
      }
    }
    let state;
    for (;;) {
      state = await Promise.all(queues.map(async queue => ({
        name: queue.name, paused: await queue.isPaused(), active: await queue.getActiveCount(),
      })));
      if (action !== 'pause' || state.every(queue => queue.paused && queue.active === 0)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    process.stdout.write(JSON.stringify({ queues: state }) + '\n');
  } finally {
    await Promise.all(queues.map(queue => queue.close()));
    await connection.quit();
    clearTimeout(deadline);
  }
})().catch(() => { console.error('Legacy queue operation failed'); process.exitCode = 1; });

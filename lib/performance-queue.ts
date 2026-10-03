// Read-only subset of BullMQ 5 list/zset layout. Never scan jobs or return IDs.
// The head age describes the next FIFO entry, not the minimum timestamp across
// requeued, prioritized, delayed or paused jobs. Compatibility is integration-tested.
export const QUEUE_SNAPSHOT_LUA = `
local p = KEYS[1]
local id = redis.call('LINDEX', p .. 'wait', -1)
local markers = 0
if id and string.sub(id, 1, 2) == '0:' then
  markers = 1
  id = redis.call('LINDEX', p .. 'wait', -2)
end
local timestamp = id and redis.call('HGET', p .. id, 'timestamp') or ''
return {
  math.max(0, redis.call('LLEN', p .. 'wait') - markers),
  redis.call('LLEN', p .. 'active'),
  redis.call('ZCARD', p .. 'delayed'),
  redis.call('LLEN', p .. 'paused'),
  redis.call('ZCARD', p .. 'prioritized'),
  timestamp or ''
}
`;
export function parseQueueSnapshot(value: unknown) {
  if (!Array.isArray(value) || value.length !== 6) return null;
  const counts = value.slice(0, 5).map(Number);
  if (!counts.every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  const timestamp = Number(value[5]);
  const age = Date.now() - timestamp;
  return { waiting: counts[0], active: counts[1], delayed: counts[2], paused: counts[3], prioritized: counts[4], headAgeMs: counts[0] > 0 && timestamp > 0 && Number.isFinite(age) && age >= 0 ? age : null };
}

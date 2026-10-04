import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLegacyWorker } from './signal-legacy-worker.mjs';

const parent = ['node', '/app/node_modules/.bin/tsx', 'worker.ts'];
const child = { pid: 17, args: ['node', '--require', '/app/node_modules/tsx/dist/preflight.cjs',
  '--import', 'file:///app/node_modules/tsx/dist/loader.mjs', 'worker.ts'] };
test('selects only the original tsx Worker direct child', () => {
  assert.equal(selectLegacyWorker(parent, [child, { pid: 18, args: ['node', '-'] }]), 17);
});
test('refuses a different wrapper, missing or ambiguous Worker and PID 1', () => {
  for (const [args, children] of [
    [['node', 'scripts/worker-supervisor.mjs'], [child]], [parent, []],
    [parent, [child, { ...child, pid: 19 }]], [parent, [{ ...child, pid: 1 }]],
    [parent, [{ ...child, args: ['node', 'worker.ts'] }]],
  ]) assert.throws(() => selectLegacyWorker(args, children));
});

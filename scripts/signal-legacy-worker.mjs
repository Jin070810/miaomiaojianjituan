import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export function selectLegacyWorker(parentArgs, children) {
  assert.ok(parentArgs.some(arg => /\/node_modules\/\.bin\/tsx$/.test(arg)));
  assert.equal(parentArgs.at(-1), 'worker.ts');
  const workers = children.filter(child => child.args.at(-1) === 'worker.ts'
    && child.args.some(arg => /\/tsx\/dist\/preflight\.cjs$/.test(arg))
    && child.args.some(arg => /\/tsx\/dist\/loader\.mjs$/.test(arg)));
  assert.equal(workers.length, 1, 'Expected exactly one original tsx Worker child');
  assert.ok(Number.isSafeInteger(workers[0].pid) && workers[0].pid > 1);
  return workers[0].pid;
}

if (process.env.LEGACY_SIGNAL_EXECUTE === 'true') {
  assert.equal(process.env.APP_COMMIT_SHA, '752b084ec220ce5c827609611e51ce718b28b92d');
  assert.equal(process.cwd(), '/app');
  const args = pid => readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
  const children = readFileSync('/proc/1/task/1/children', 'utf8').trim().split(/\s+/).filter(Boolean)
    .map(Number).filter(pid => pid !== process.pid).map(pid => ({ pid, args: args(pid) }));
  const pid = selectLegacyWorker(args(1), children);
  process.kill(pid, 'SIGTERM');
  process.stdout.write(JSON.stringify({ strategy: 'legacy-child-term', childPid: pid, signal: 'SIGTERM' }) + '\n');
}

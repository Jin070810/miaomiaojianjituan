import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
export async function observeRelease(probe, { commit, deployment, durationMs = 30 * 60_000, intervalMs = 30_000, now = Date.now, wait = sleep, save = () => {} }) {
  const start = now();
  const result = { commit, deployment, status: 'failed', startedAt: new Date(start).toISOString(), samples: [] };
  let failures = 0, busySince = null, initialIntegrity = false, healthySince = start;
  while (true) {
    const final = healthySince !== null && now() - healthySince >= durationMs;
    const mode = !initialIntegrity || final ? 'integrity' : 'health';
    let sample;
    try { sample = await probe(mode); }
    catch { sample = { state: 'unhealthy', reason: 'probe_unavailable' }; }
    const valid = sample?.state === 'healthy' && sample.commit === commit && (mode !== 'integrity' || sample.integrity === true);
    if (sample?.state === 'healthy' && !valid) sample = { state: 'unhealthy', reason: 'inconsistent_probe' };
    result.samples.push({ ...sample, checkedAt: new Date(now()).toISOString() });
    result.finishedAt = new Date(now()).toISOString();
    save(result); // Interrupted runners retain incomplete evidence, never a pass.
    if (sample?.state === 'superseded' && /^[1-9][0-9]*-[1-9][0-9]*$/.test(sample.successor) && sample.successor !== deployment) {
      result.status = 'superseded'; break;
    }
    if (valid) {
      failures = 0; busySince = null;
      healthySince ??= now();
      if (mode === 'integrity') initialIntegrity = true;
      if (final) { result.status = 'passed'; break; }
    } else if (sample?.state === 'busy') {
      healthySince = null;
      busySince ??= now();
      // A real deployment can hold the lock for 32 minutes. Do not mislabel its
      // maintenance as an outage; bound the overall observation to 65 minutes.
      if (now() - busySince >= 33 * 60_000) break;
    } else { healthySince = null; if (++failures >= 3) break; }
    if (now() - start >= 65 * 60_000) break;
    await wait(intervalMs);
  }
  save(result);
  return result;
}

function hostProbe(mode, record) {
  const { PRODUCTION_HOST: host, PRODUCTION_USER: user, PRODUCTION_PATH: root, PRODUCTION_DOMAIN: domain } = process.env;
  if (!/^[A-Za-z0-9.-]+$/.test(host) || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(user) || !root?.startsWith('/') || /[\r\n\0]/.test(root)
    || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(domain)) throw new Error('Invalid observation target');
  const remote = `timeout --signal=TERM --kill-after=5s 140s bash -s -- ${[root, record.commit, record.deployment, domain, mode].map(quote).join(' ')}`;
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [`${user}@${host}`, remote], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 150_000 });
    let output = '', oversized = false;
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 4096) { oversized = true; child.kill('SIGTERM'); } });
    child.stderr.resume(); // Never echo host paths, raw errors, or member data.
    child.on('error', reject);
    child.on('close', code => {
      if (oversized) return reject(new Error('Oversized observation'));
      try {
        const data = JSON.parse(output);
        if (code && data.state !== 'unhealthy') throw new Error('Observation failed');
        resolve(data);
      } catch { reject(new Error('Invalid observation response')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(readFileSync('scripts/probe-production-release.sh'));
  });
}
async function main() {
  const record = JSON.parse(readFileSync('output/release/release-record.json', 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(record.commit) || !/^[1-9][0-9]*-[1-9][0-9]*$/.test(record.deployment)) throw new Error('Invalid release record');
  const result = await observeRelease(mode => hostProbe(mode, record), { ...record, save: value => writeFileSync('output/release/observation.json', JSON.stringify(value, null, 2)) });
  console.log(`Release observation: ${result.status}; samples=${result.samples.length}`);
  if (result.status === 'failed') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

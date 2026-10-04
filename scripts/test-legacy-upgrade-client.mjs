// Disposable original-image stack only; never probes the public production site.
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { writeFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';

assert.equal(process.env.CI, 'true');
assert.equal(process.env.LEGACY_INTERNAL_NETWORK, 'true');
const [directory, mode] = process.argv.slice(2);
assert.ok(directory?.startsWith(`${process.env.RUNNER_TEMP}/legacy-qualification.`));
assert.ok(['legacy', 'protected'].includes(mode));
const socket = tls.connect({ host: 'nginx', port: 443, rejectUnauthorized: false });
let response = '';
socket.on('data', chunk => { response += chunk; if (response.length > 65536) socket.destroy(); });
socket.on('error', () => {});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.destroy(); reject(new Error('Isolated proxy connection timeout')); }, 5000);
  socket.once('secureConnect', () => { clearTimeout(timer); resolve(); });
  socket.once('error', error => { clearTimeout(timer); reject(error); });
});
socket.write('GET /__legacy_upgrade_probe HTTP/1.1\r\nHost: legacy.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
for (let i = 0; i < 50 && !response.startsWith('HTTP/'); i++) await wait(100);
socket.destroy();
await wait(500);
const status = /^HTTP\/1\.[01] (\d{3})/.exec(response)?.[1] ?? null;
writeFileSync(`${directory}/upgrade-${mode}.json`, JSON.stringify({ mode, isolatedSyntheticData: true, clientClosed: true, status: status === null ? null : Number(status) }));
assert.equal(status, mode === 'legacy' ? null : '404');

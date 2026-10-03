// Executed through stdin inside the exact candidate App, without published ports.
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

const commit = process.argv[2];
assert.match(commit, /^[a-f0-9]{40}$/);
const base = "http://127.0.0.1:3000";
async function get(route) {
  const response = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(5000), redirect: "error" });
  assert.equal(response.status, 200, `candidate route failed: ${route.split("?")[0]}`);
  return response;
}
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const health = await (await get("/api/health/ready")).json();
    assert.equal(health.ok, true);
    assert.equal(health.app?.commit, commit);
    assert.equal(health.database, "ok");
    assert.equal(health.redis, "ok");
    ready = true;
    break;
  } catch {
    await setTimeout(1000);
  }
}
assert.equal(ready, true, "candidate readiness/version check failed");
const html = await (await get("/login")).text();
const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"<>]+\.(?:js|css)(?:\?[^"<>]*)?)"/g)].map(match => match[1].replaceAll("&amp;", "&")))];
assert.ok(assets.length > 0 && assets.length <= 100, "login static assets missing or unexpected");
for (const asset of assets) await (await get(asset)).arrayBuffer();
const image = await get("/_next/image?url=%2Favatars%2Fdefault.webp&w=128&q=75");
assert.match(image.headers.get("content-type") ?? "", /^image\//);
assert.ok((await image.arrayBuffer()).byteLength > 0);
console.log(JSON.stringify({ ok: true, commit, staticAssets: assets.length, imageOptimization: true }));

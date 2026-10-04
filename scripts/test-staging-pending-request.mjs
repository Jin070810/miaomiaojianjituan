// Synthetic invalid login body: exercises real Next request drain without users,
// credentials or a production-only endpoint. The Docker adapter releases it only
// after SIGTERM has been sent and the App is still running.
import http from "node:http";
import { existsSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

assert.equal(process.env.CI, "true");
assert.equal(process.env.POSTGRES_DB, "miaomiao_staging");
const directory = process.argv[2];
assert.ok(directory && !directory.includes("\0"));
const body = JSON.stringify({ kuaishouId: "", password: "" });
let interval;
const timeout = setTimeout(() => { request.destroy(new Error("drain fixture timed out")); }, 240_000);
const request = http.request("http://127.0.0.1:3000/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
}, response => {
  response.resume();
  response.on("end", () => {
    clearTimeout(timeout);
    clearInterval(interval);
    assert.equal(response.statusCode, 400);
    writeFileSync(`${directory}/pending-completed.json`, JSON.stringify({ status: response.statusCode, completed: true }));
  });
});
request.on("error", error => { clearTimeout(timeout); clearInterval(interval); console.error(error.message); process.exitCode = 1; });
request.flushHeaders();
request.write(body.slice(0, 1), () => {
  writeFileSync(`${directory}/pending-ready`, "ready\n");
  interval = setInterval(() => {
    if (existsSync(`${directory}/pending-release`)) {
      clearInterval(interval);
      request.end(body.slice(1));
    }
  }, 50);
});

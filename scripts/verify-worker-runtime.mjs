import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import nodemailer from "nodemailer";
import { workerRuntimeDependencies } from "./worker-runtime-deps.mjs";
import { hashPassword, verifyPassword, encryptSensitive, decryptSensitive } from "../lib/security.ts";
import { db } from "../lib/db.ts";

// Run only against an isolated verification container. No DB/Redis/OSS or real email is contacted.
const require = createRequire(import.meta.url);
const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
for (const name of workerRuntimeDependencies) {
  assert.ok(manifest.dependencies[name], `Missing direct runtime dependency: ${name}`);
  // Prisma is a CLI and intentionally has no usable runtime root export.
  require.resolve(name === "prisma" ? "prisma/package.json" : name);
}
for (const name of ["next", "react", "react-dom", "vitest", "@vitest/mocker", "@playwright/test", "@fontsource/noto-serif-sc", "@fontsource-variable/noto-sans-sc", "@phosphor-icons/react", "lucide-react"]) {
  assert.equal(fs.existsSync(`node_modules/${name}`), false, `Unexpected Web/test package: ${name}`);
}
await Promise.all([
  import("../lib/video-jobs.ts"),
  import("../lib/weekly-challenge-generation.ts"),
  import("../lib/worker-maintenance.ts"),
  import("../lib/redemption-reconciliation.ts"),
  import("../lib/oss-backup.ts"),
]);
const password = "Synthetic-worker-runtime-check";
const passwordHash = await hashPassword(password);
assert.equal(await verifyPassword(passwordHash, password), true);
assert.equal(await verifyPassword(passwordHash, "wrong"), false);
process.env.PHONE_ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
assert.equal(decryptSensitive(encryptSensitive("synthetic-data")), "synthetic-data");
const transport = nodemailer.createTransport({ jsonTransport: true });
const sent = await transport.sendMail({ from: "smoke@example.invalid", to: "smoke@example.invalid", subject: "runtime check", text: "synthetic" });
assert.equal(JSON.parse(sent.message).subject, "runtime check");
transport.close();
await db.$disconnect();
const browser = await chromium.launch({ executablePath: process.env.DOUYIN_BROWSER_EXECUTABLE_PATH || (process.platform === "linux" ? "/usr/bin/chromium" : undefined), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.goto("data:text/html,<title>Worker runtime</title><p>ready</p>");
  assert.equal(await page.title(), "Worker runtime");
  console.log(`Chromium runtime passed: ${browser.version()}`);
} finally { await browser.close(); }
if (fs.existsSync("worker-deps-before.json") && fs.existsSync("worker-deps-after.json")) {
  const before = JSON.parse(fs.readFileSync("worker-deps-before.json", "utf8"));
  const after = JSON.parse(fs.readFileSync("worker-deps-after.json", "utf8"));
  assert.ok(after.bytes < before.bytes, "Pruning did not reduce runtime dependencies");
  console.log(JSON.stringify({ dependencyBytesBefore: before.bytes, dependencyBytesAfter: after.bytes, savedBytes: before.bytes - after.bytes, filesBefore: before.files, filesAfter: after.files }));
}
console.log("Worker runtime imports, native crypto, Prisma client, JSON mail transport and Chromium passed");

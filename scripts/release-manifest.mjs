import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const shaPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const checks = ["core", "audit", "e2e", "staging"];
function requireValue(condition, message) {
  if (!condition) throw new Error(`发布候选验证失败：${message}`);
}
function positiveInteger(value) {
  return /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
}
function hashFile(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
function inventory(source) {
  const base = path.join(source, "prisma/migrations");
  const files = readdirSync(base, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? [`${entry.name}/migration.sql`] : entry.name === "migration_lock.toml" ? [entry.name] : []);
  requireValue(files.length > 1, "缺少 migration 清单");
  return files.sort().map(file => ({ path: file, sha256: hashFile(path.join(base, file)) }));
}
function validateIdentity(repository, commit, runId) {
  requireValue(typeof repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), "仓库名称无效");
  requireValue(shaPattern.test(commit), "commit 必须是完整 SHA");
  requireValue(positiveInteger(runId), "CI run ID 无效");
}
function validateImages(images, repository) {
  for (const kind of ["app", "worker"]) {
    const image = images?.[kind];
    requireValue(image?.name === `ghcr.io/${repository.toLowerCase()}-${kind}`, `${kind} 镜像不属于当前仓库`);
    requireValue(digestPattern.test(image?.digest), `${kind} digest 无效`);
    requireValue(digestPattern.test(image?.configId), `${kind} 已验收镜像 ID 无效`);
  }
}

export function createManifest(input, source) {
  validateIdentity(input.repository, input.commit, input.runId);
  requireValue(positiveInteger(input.runAttempt), "CI attempt 无效");
  validateImages(input.images, input.repository);
  requireValue(typeof input.buildTime === "string" && /^\d{4}-\d{2}-\d{2}T/.test(input.buildTime) && Number.isFinite(Date.parse(input.buildTime)), "buildTime 无效");
  return {
    schemaVersion: 1,
    repository: input.repository,
    commit: input.commit,
    buildTime: input.buildTime,
    ci: { workflow: ".github/workflows/ci.yml", runId: String(input.runId), runAttempt: Number(input.runAttempt) },
    checks: Object.fromEntries(checks.map(name => [name, true])),
    images: structuredClone(input.images),
    schemaSha256: hashFile(path.join(source, "prisma/schema.prisma")),
    migrations: inventory(source),
  };
}

// Read the run from GitHub's authenticated API, never from the downloaded artifact.
export function validateRun(run, expected) {
  validateIdentity(expected.repository, expected.commit, expected.runId);
  requireValue(String(run.id) === String(expected.runId), "CI run ID 不匹配");
  requireValue(run.repository?.full_name?.toLowerCase() === expected.repository.toLowerCase(), "CI 仓库不匹配");
  requireValue(run.head_repository?.full_name?.toLowerCase() === expected.repository.toLowerCase(), "拒绝 fork 候选");
  requireValue(run.path === ".github/workflows/ci.yml", "只接受 CI workflow 的产物");
  requireValue(run.event === "push" && run.head_branch === "main", "只接受 main push 的候选");
  requireValue(run.head_sha === expected.commit, "CI 没有验收当前 release SHA");
  requireValue(run.status === "completed" && run.conclusion === "success", "CI 未全部成功");
  requireValue(positiveInteger(run.run_attempt), "CI attempt 无效");
  return Number(run.run_attempt);
}

export function validateManifest(manifest, run, expected) {
  const attempt = validateRun(run, expected);
  requireValue(manifest.schemaVersion === 1, "不支持的清单版本");
  requireValue(manifest.repository?.toLowerCase() === expected.repository.toLowerCase(), "清单仓库不匹配");
  requireValue(manifest.commit === expected.commit, "清单 SHA 不匹配");
  requireValue(manifest.ci?.workflow === run.path && String(manifest.ci?.runId) === String(run.id) && manifest.ci?.runAttempt === attempt, "清单不是本次 CI attempt 产物");
  requireValue(checks.every(name => manifest.checks?.[name] === true), "验收证据不完整");
  validateImages(manifest.images, expected.repository);
  requireValue(typeof manifest.buildTime === "string" && /^\d{4}-\d{2}-\d{2}T/.test(manifest.buildTime) && Number.isFinite(Date.parse(manifest.buildTime)), "buildTime 无效");
  requireValue(manifest.schemaSha256 === hashFile(path.join(expected.source, "prisma/schema.prisma")), "Prisma schema 不匹配");
  requireValue(JSON.stringify(manifest.migrations) === JSON.stringify(inventory(expected.source)), "migration 文件或校验和不匹配");
  return {
    release_commit: manifest.commit, build_time: manifest.buildTime,
    app_image: manifest.images.app.name, app_digest: manifest.images.app.digest, app_config_id: manifest.images.app.configId,
    worker_image: manifest.images.worker.name, worker_digest: manifest.images.worker.digest, worker_config_id: manifest.images.worker.configId,
  };
}

function output(values) {
  const text = Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join("");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text);
  else process.stdout.write(text);
}
function json(file) { return JSON.parse(readFileSync(file, "utf8")); }
function main() {
  const [command, file, ...args] = process.argv.slice(2);
  if (command === "create") {
    const env = process.env;
    const manifest = createManifest({
      repository: env.GITHUB_REPOSITORY, commit: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID,
      runAttempt: env.GITHUB_RUN_ATTEMPT, buildTime: env.APP_BUILD_TIME,
      images: {
        app: { name: env.APP_IMAGE, digest: env.APP_DIGEST, configId: env.APP_CONFIG_ID },
        worker: { name: env.WORKER_IMAGE, digest: env.WORKER_DIGEST, configId: env.WORKER_CONFIG_ID },
      },
    }, args[0] ?? ".");
    writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  } else if (command === "verify-run") {
    const [commit, runId] = args;
    output({ attempt: validateRun(json(file), { repository: process.env.GITHUB_REPOSITORY, commit, runId }) });
  } else if (command === "verify") {
    const [runFile, commit, runId, source] = args;
    output(validateManifest(json(file), json(runFile), { repository: process.env.GITHUB_REPOSITORY, commit, runId, source }));
  } else {
    throw new Error("用法: release-manifest.mjs create <manifest> [source] | verify-run <run.json> <sha> <runId> | verify <manifest> <run.json> <sha> <runId> <source>");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

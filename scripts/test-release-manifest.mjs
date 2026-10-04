import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createManifest, validateManifest, validateRun } from "./release-manifest.mjs";

const source = mkdtempSync(path.join(os.tmpdir(), "release-manifest-"));
mkdirSync(path.join(source, "prisma/migrations/20260101000000_initial"), { recursive: true });
writeFileSync(path.join(source, "prisma/migrations/20260101000000_initial/migration.sql"), "SELECT 1;\n");
writeFileSync(path.join(source, "prisma/migrations/migration_lock.toml"), 'provider = "postgresql"\n');
writeFileSync(path.join(source, "prisma/schema.prisma"), "// schema\n");
after(() => rmSync(source, { recursive: true, force: true }));
const repository = "Example/points";
const commit = "a".repeat(40);
const run = {
  id: 123, run_attempt: 2, event: "push", head_branch: "main", head_sha: commit,
  status: "completed", conclusion: "success", path: ".github/workflows/ci.yml",
  repository: { full_name: repository }, head_repository: { full_name: repository },
};
const image = (kind, character) => ({
  name: `ghcr.io/example/points-${kind}`, digest: `sha256:${character.repeat(64)}`,
  configId: `sha256:${character.repeat(64)}`,
});
const input = {
  repository, commit, runId: "123", runAttempt: "2", buildTime: "2026-10-03T13:00:00Z",
  images: { app: image("app", "b"), worker: image("worker", "c") },
};
const expected = { repository, commit, runId: "123", source };
const valid = () => createManifest(input, source);

test("validated main candidate produces exact digest outputs and complete migration inventory", () => {
  const output = validateManifest(valid(), run, expected);
  assert.equal(output.app_digest, input.images.app.digest);
  assert.equal(output.worker_digest, input.images.worker.digest);
  assert.equal(output.release_commit, commit);
  assert.equal(valid().migrations.length, 2);
});

for (const [field, value] of [
  ["event", "pull_request"], ["event", "pull_request_target"], ["head_branch", "feature/unreviewed"],
  ["head_sha", "d".repeat(40)], ["status", "in_progress"], ["conclusion", "failure"],
  ["conclusion", "cancelled"], ["path", ".github/workflows/other.yml"], ["id", 456],
  ["repository", { full_name: "Other/points" }], ["head_repository", { full_name: "Fork/points" }],
]) {
  test(`rejects untrusted or unsuccessful workflow run: ${field}=${JSON.stringify(value)}`, () => {
    assert.throws(() => validateRun({ ...run, [field]: value }, expected));
  });
}

for (const [label, mutate] of [
  ["unsupported schema", m => { m.schemaVersion = 99; }],
  ["other commit", m => { m.commit = "d".repeat(40); }],
  ["another attempt", m => { m.ci.runAttempt = 1; }],
  ["another run", m => { m.ci.runId = "456"; }],
  ["other repository", m => { m.repository = "Other/points"; }],
  ["mutable image tag", m => { m.images.app.digest = "latest"; }],
  ["other image repository", m => { m.images.worker.name = "ghcr.io/evil/worker"; }],
  ["invalid image ID", m => { m.images.worker.configId = "unknown"; }],
  ["missing staging proof", m => { m.checks.staging = false; }],
  ["missing E2E proof", m => { delete m.checks.e2e; }],
  ["missing migration", m => { m.migrations.pop(); }],
  ["modified migration", m => { m.migrations[0].sha256 = "0".repeat(64); }],
  ["modified schema", m => { m.schemaSha256 = "0".repeat(64); }],
  ["invalid build time", m => { m.buildTime = "unknown"; }],
]) {
  test(`rejects manifest: ${label}`, () => {
    const manifest = valid();
    mutate(manifest);
    assert.throws(() => validateManifest(manifest, run, expected));
  });
}

test("a rerun cannot consume a prior attempt's manifest", () => {
  assert.throws(() => validateManifest(valid(), { ...run, run_attempt: 3 }, expected));
});

test("comparison checks the release source rather than trusting a manifest checksum alone", () => {
  const manifest = valid();
  const migration = path.join(source, "prisma/migrations/20260101000000_initial/migration.sql");
  writeFileSync(migration, "SELECT 2;\n");
  try { assert.throws(() => validateManifest(manifest, run, expected)); }
  finally { writeFileSync(migration, "SELECT 1;\n"); }
});

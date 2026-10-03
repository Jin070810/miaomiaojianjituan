import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Versions come exclusively from the root lockfile. This is a runtime boundary, not another lock.
export const workerRuntimeDependencies = [
  "@prisma/client", "ali-oss", "argon2", "bullmq", "dotenv", "ioredis", "nodemailer",
  "playwright-core", "prisma", "tsx", "zod",
];

export function workerPackage(source, lock) {
  if (lock.lockfileVersion !== 3 || !lock.packages?.[""]) throw new Error("Worker requires the root npm v3 lockfile");
  const declared = { ...source.dependencies, ...source.devDependencies };
  const dependencies = Object.fromEntries(workerRuntimeDependencies.map((name) => {
    const locked = lock.packages[`node_modules/${name}`];
    if (!declared[name] || !locked?.version || !locked.integrity || !locked.resolved?.startsWith("https://")) {
      throw new Error(`Missing locked Worker dependency: ${name}`);
    }
    return [name, locked.version];
  }));
  return {
    name: `${source.name}-worker`, version: source.version, private: true,
    dependencies, ...(source.overrides ? { overrides: source.overrides } : {}),
    scripts: Object.fromEntries(Object.entries(source.scripts ?? {}).filter(([key]) => [
      "worker", "db:generate", "db:deploy", "seed:admin", "data:reconcile", "redemption:reconcile",
      "ops:daily-check", "ops:upload-backup", "ops:download-backup", "ops:alert", "growth:rebuild",
    ].includes(key))),
  };
}

export function verifyWorkerLock(original, reduced) {
  if (reduced.lockfileVersion !== 3) throw new Error("Unexpected runtime lock format");
  const names = Object.keys(reduced.packages?.[""]?.dependencies ?? {}).sort();
  if (JSON.stringify(names) !== JSON.stringify([...workerRuntimeDependencies].sort())) throw new Error("Worker root dependencies changed");
  for (const [location, entry] of Object.entries(reduced.packages)) {
    if (!location) continue;
    const before = original.packages[location];
    if (!before || entry.version !== before.version || entry.integrity !== before.integrity || entry.resolved !== before.resolved) {
      throw new Error(`Worker prune changed a locked artifact: ${location}`);
    }
  }
  for (const name of workerRuntimeDependencies) {
    const location = `node_modules/${name}`;
    if (!reduced.packages[location] || reduced.packages[location].dev) throw new Error(`Missing production runtime dependency: ${name}`);
    if (reduced.packages[""].dependencies[name] !== original.packages[location].version) throw new Error(`Unpinned runtime version: ${name}`);
  }
}

export function measureDirectory(directory) {
  let bytes = 0;
  let files = 0;
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) { bytes += fs.statSync(child).size; files++; }
      // Do not follow executable symlinks or any link outside the measured tree.
    }
  }
  walk(directory);
  return { bytes, files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, directory = ".", originalFile] = process.argv.slice(2);
  const read = (name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
  if (action === "prepare") {
    fs.writeFileSync(path.join(directory, "package.json"), `${JSON.stringify(workerPackage(read("package.json"), read("package-lock.json")), null, 2)}\n`);
  } else if (action === "verify" && originalFile) {
    verifyWorkerLock(JSON.parse(fs.readFileSync(originalFile, "utf8")), read("package-lock.json"));
    console.log("Worker dependency artifacts match the root lockfile");
  } else if (action === "measure") console.log(JSON.stringify(measureDirectory(directory)));
  else throw new Error("Usage: worker-runtime-deps.mjs prepare <directory> | verify <directory> <original-lock-file> | measure <node_modules>");
}

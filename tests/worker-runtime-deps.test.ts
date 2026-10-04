import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { workerPackage, verifyWorkerLock, workerRuntimeDependencies } from "../scripts/worker-runtime-deps.mjs";
import { rateLimitResponse } from "@/lib/security";
import { RateLimitError } from "@/lib/rate-limit";

const source = JSON.parse(fs.readFileSync("package.json", "utf8"));
const original = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
function fixtureLock() {
  const pkg = workerPackage(source, original);
  const packages: Record<string, Record<string, unknown>> = { "": { dependencies: pkg.dependencies } };
  for (const name of workerRuntimeDependencies) packages[`node_modules/${name}`] = { ...original.packages[`node_modules/${name}`], dev: false };
  return { lockfileVersion: 3, packages };
}

describe("Worker dependency boundary", () => {
  it("keeps migration/TypeScript executors as production dependencies pinned by the root lock", () => {
    const pkg = workerPackage(source, original);
    expect(pkg.dependencies.prisma).toBe(original.packages["node_modules/prisma"].version);
    expect(pkg.dependencies.tsx).toBe(original.packages["node_modules/tsx"].version);
    expect(pkg.dependencies).not.toHaveProperty("next");
    expect(pkg.dependencies).not.toHaveProperty("vitest");
    expect(() => verifyWorkerLock(original, fixtureLock())).not.toThrow();
  });
  it("rejects drift in versions, resolved downloads, integrity or unexpected dependency additions", () => {
    for (const key of ["version", "integrity", "resolved"]) {
      const lock = fixtureLock(); lock.packages["node_modules/tsx"][key] = "changed";
      expect(() => verifyWorkerLock(original, lock)).toThrow("locked artifact");
    }
    const added = fixtureLock(); added.packages["node_modules/unreviewed"] = { version: "1.0.0" };
    expect(() => verifyWorkerLock(original, added)).toThrow("locked artifact");
  });
  it("rejects missing or development-only executors", () => {
    const missing = fixtureLock(); delete missing.packages["node_modules/prisma"];
    expect(() => verifyWorkerLock(original, missing)).toThrow("runtime dependency");
    const dev = fixtureLock(); dev.packages["node_modules/tsx"].dev = true;
    expect(() => verifyWorkerLock(original, dev)).toThrow("runtime dependency");
  });
  it("all Worker and copied CLI source imports stay inside the reviewed runtime boundary", () => {
    const dockerfile = fs.readFileSync("Dockerfile", "utf8");
    const entries = new Set(["worker.ts"]);
    for (const line of dockerfile.split(/\r?\n/)) {
      if (!line.startsWith("COPY ") || line.includes("--from=")) continue;
      for (const file of line.split(/\s+/).slice(1, -1)) if (/\.(?:ts|js|mjs)$/.test(file)) entries.add(file);
    }
    const seen = new Set<string>();
    const unexpected: string[] = [];
    function visit(file: string) {
      if (seen.has(file)) return; seen.add(file);
      const sourceFile = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const imports: string[] = [];
      function walk(node: ts.Node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments.length && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
        ts.forEachChild(node, walk);
      }
      walk(sourceFile);
      for (const spec of imports) {
        if (spec.startsWith("node:") || builtinModules.includes(spec)) continue;
        if (spec.startsWith(".") || spec.startsWith("@/")) {
          const base = spec.startsWith("@/") ? spec.slice(2) : path.join(path.dirname(file), spec);
          const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, "index.ts")].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
          if (!resolved) throw new Error(`Unresolved Worker import: ${file} -> ${spec}`);
          visit(resolved);
        } else {
          const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
          if (!workerRuntimeDependencies.includes(name)) unexpected.push(`${file} -> ${spec}`);
        }
      }
    }
    entries.forEach(visit);
    expect(seen.size).toBeGreaterThan(25);
    expect(unexpected).toEqual([]);
  });
  it("native Response preserves the HTTP rate-limit status, payload and retry header", async () => {
    const response = rateLimitResponse(new RateLimitError(17));
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("17");
    expect(response?.headers.get("content-type")).toContain("application/json");
    expect(await response?.json()).toEqual({ error: "操作过于频繁，请稍后再试" });
    expect(rateLimitResponse(new Error("unrelated"))).toBeNull();
  });
});

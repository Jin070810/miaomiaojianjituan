import "dotenv/config";

const target = process.env.SMOKE_URL ?? "http://127.0.0.1:3000/api/health";
const concurrency = Math.min(50, Math.max(1, Number(process.env.SMOKE_CONCURRENCY ?? 20)));
const timeoutMs = Math.min(30_000, Math.max(1_000, Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000)));

async function requestOnce() {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, { cache: "no-store", signal: controller.signal });
    return { status: response.status, ms: Date.now() - started };
  } catch (error) {
    return { status: 0, ms: Date.now() - started, error: error instanceof Error ? error.message : "request failed" };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const results = await Promise.all(Array.from({ length: concurrency }, requestOnce));
  const successful = results.filter((result) => result.status >= 200 && result.status < 300);
  const durations = results.map((result) => result.ms).sort((a, b) => a - b);
  const percentile = (fraction: number) => durations[Math.min(durations.length - 1, Math.floor(durations.length * fraction))] ?? 0;
  const summary = {
    target,
    concurrency,
    successful: successful.length,
    failed: results.length - successful.length,
    minMs: durations[0] ?? 0,
    p95Ms: percentile(0.95),
    maxMs: durations.at(-1) ?? 0,
    statuses: Object.fromEntries(results.reduce((counts, result) => counts.set(String(result.status), (counts.get(String(result.status)) ?? 0) + 1), new Map<string, number>())),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (successful.length !== results.length) process.exitCode = 1;
}

void main();

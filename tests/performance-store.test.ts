import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ instances: 0, connects: 0, disconnects: 0, commands: [] as unknown[][], stall: false, replies: [] as [null, unknown][] }));
vi.mock("ioredis", () => ({ default: class {
  status = "wait";
  constructor() { state.instances++; }
  on() { return this; }
  async connect() { state.connects++; await Promise.resolve(); this.status = "ready"; }
  disconnect() { state.disconnects++; }
  multi() {
    const chain = {
      hincrby: (...args: unknown[]) => { state.commands.push(args); return chain; },
      hincrbyfloat: (...args: unknown[]) => { state.commands.push(args); return chain; },
      expire: (...args: unknown[]) => { state.commands.push(args); return chain; },
      exec: () => state.stall ? new Promise(() => undefined) : Promise.resolve([[null, 1]]),
    };
    return chain;
  }
  pipeline() { const chain = { hgetall: () => chain, get: () => chain, eval: () => chain, exec: async () => state.replies }; return chain; }
} }));
import { closePerformanceStore, getPerformanceSnapshot, recordPerformance } from "../lib/performance-store";
describe("bounded metrics store", () => {
  beforeEach(() => {
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379/15");
    closePerformanceStore(); state.instances = 0; state.connects = 0; state.disconnects = 0; state.commands = []; state.stall = false; state.replies = [];
  });
  afterEach(() => { closePerformanceStore(); vi.useRealTimers(); vi.unstubAllEnvs(); });
  it("shares initial connection and admits no arbitrary metric labels", async () => {
    expect(await Promise.all(Array.from({ length: 8 }, () => recordPerformance("me_get", 120)))).toEqual(Array(8).fill(true));
    expect(state.connects).toBe(1);
    expect(await recordPerformance("secret-user-id", 120)).toBe(false);
    expect(state.commands.some((command) => JSON.stringify(command).includes("secret-user-id"))).toBe(false);
    expect(state.commands.some((command) => command[1] === 72 * 3600)).toBe(true);
  });
  it("bounds hung Redis and skips retries during the circuit break", async () => {
    vi.useFakeTimers(); state.stall = true;
    const pending = recordPerformance("home_get", 120);
    await vi.advanceTimersByTimeAsync(801);
    expect(await pending).toBe(false);
    expect(state.disconnects).toBe(1);
    expect(await recordPerformance("home_get", 120)).toBe(false);
    expect(state.instances).toBe(1);
    expect((await getPerformanceSnapshot()).status).toBe("unavailable");
  });
  it("drops excess in-flight writes instead of accumulating an unbounded queue", async () => {
    vi.useFakeTimers(); state.stall = true;
    const pending = Array.from({ length: 8 }, () => recordPerformance("home_get", 120));
    expect(await recordPerformance("home_get", 120)).toBe(false);
    expect(state.instances).toBe(1);
    await vi.advanceTimersByTimeAsync(801);
    expect(await Promise.all(pending)).toEqual(Array(8).fill(false));
  });
  it("aggregates hourly buckets while dropping invalid fields and stale resources", async () => {
    state.replies = Array.from({ length: 26 }, () => [null, null]);
    state.replies[0] = [null, { "me_get:b1": "2", "me_get:sum": "150", "me_get:errors": "1", "private-id:b0": "9", "me_get:b999": "8", "me_get:b0": "-3" }];
    state.replies[1] = [null, { "me_get:b2": "1", "me_get:sum": "200" }];
    state.replies[24] = [null, JSON.stringify({ at: new Date(Date.now() - 61000).toISOString(), role: "web", rssBytes: 10, heapUsedBytes: 8, uptimeSeconds: 3, cpuPercent: 5 })];
    const snapshot = await getPerformanceSnapshot();
    expect(snapshot.status).toBe("ok");
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({ key: "me_get", count: 3, errorRate: 1 / 3, p95: { lower: 100, upper: 250 } });
    expect(snapshot.resources.web).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ database: vi.fn(), admins: vi.fn(), redis: vi.fn(), worker: vi.fn(), queue: vi.fn(), weekly: vi.fn(), weeklyQueue: vi.fn(), config: vi.fn(), alerts: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $queryRaw: mocks.database, user: { count: mocks.admins } } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimitStore: mocks.redis }));
vi.mock("@/lib/worker-health", () => ({ getWorkerHeartbeat: mocks.worker }));
vi.mock("@/lib/video-jobs", () => ({ getVideoQueueMetrics: mocks.queue }));
vi.mock("@/lib/weekly-challenges", () => ({ weeklyChallengeSchedulerStatus: mocks.weekly }));
vi.mock("@/lib/weekly-challenge-jobs", () => ({ getWeeklyChallengeQueueStatus: mocks.weeklyQueue }));
vi.mock("@/lib/config", () => ({ runtimeConfigIssues: mocks.config }));
vi.mock("@/lib/alerts", () => ({ operationalAlertConfigurationStatus: mocks.alerts }));
const sha = "a".repeat(40);
const heartbeat = { status: "ok", commit: sha, buildTime: "2026-10-04T00:00:00Z", heartbeatAt: "2026-10-04T00:00:00Z" };

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers();
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("APP_COMMIT_SHA", sha);
  mocks.database.mockResolvedValue([{ "?column?": 1 }]); mocks.admins.mockResolvedValue(1); mocks.redis.mockResolvedValue("ok");
  mocks.worker.mockResolvedValue(heartbeat); mocks.queue.mockResolvedValue({ waiting: 0, active: 0 });
  mocks.weekly.mockResolvedValue({ enabled: false, operationalIssues: [] }); mocks.weeklyQueue.mockResolvedValue({ schedulerConfigured: true });
  mocks.config.mockReturnValue([]); mocks.alerts.mockReturnValue({ configured: true });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("operational health failure boundaries", () => {
  it("keeps liveness independent of every database, configuration and worker check", async () => {
    mocks.config.mockReturnValue(["bad config"]);
    const { GET } = await import("@/app/api/health/live/route");
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ ok: true, app: { commit: sha } });
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
  });

  it("keeps Web ready while Worker is down, but rejects the complete operational gate", async () => {
    mocks.worker.mockResolvedValue({ ...heartbeat, status: "missing" });
    const readiness = await import("@/app/api/health/ready/route");
    expect((await readiness.GET()).status).toBe(200);
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(mocks.weekly).not.toHaveBeenCalled();
    const operations = await import("@/app/api/health/route");
    const response = await operations.GET();
    expect(response.status).toBe(503);
    expect((await response.json()).issues).toContain("视频处理Worker不可用");
  });

  it("rejects a mismatched release even though Web itself can serve traffic", async () => {
    mocks.worker.mockResolvedValue({ ...heartbeat, commit: "b".repeat(40) });
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).issues).toContain("App与Worker提交版本不一致");
  });

  it.each(["database", "redis"] as const)("rejects Web readiness when %s is unavailable", async (dependency) => {
    mocks[dependency].mockRejectedValue(new Error("dependency detail must stay private"));
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body[dependency]).toBe("unavailable");
    expect(JSON.stringify(body)).not.toContain("detail must stay private");
  });

  it("bounds Web readiness and shares one unresolved query during a probe storm", async () => {
    let release!: (value: unknown) => void;
    mocks.database.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const { GET } = await import("@/app/api/health/ready/route");
    const responses = Promise.all(Array.from({ length: 30 }, () => GET()));
    await vi.advanceTimersByTimeAsync(2500);
    expect((await responses).every((response) => response.status === 503)).toBe(true);
    expect(mocks.database).toHaveBeenCalledTimes(1);
    expect((await GET()).status).toBe(503);
    expect(mocks.database).toHaveBeenCalledTimes(1);
    release([]);
    await vi.advanceTimersByTimeAsync(1);
    expect((await GET()).status).toBe(200);
  });

  it("preserves production configuration checks and does not hide an unknown queue", async () => {
    mocks.config.mockReturnValue(["SESSION_SECRET不符合生产要求"]);
    const readiness = await import("@/app/api/health/ready/route");
    expect((await readiness.GET()).status).toBe(503);
    mocks.queue.mockRejectedValue(new Error("queue unavailable"));
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).issues).toContain("视频队列状态不可用");
  });

  it("keeps scheduler degradation separate and retains the legacy operational response fields", async () => {
    mocks.weekly.mockResolvedValue({ enabled: true, providerConfigured: true, operationalIssues: ["当前周挑战周期缺失"] });
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ ok: true, degraded: true, database: "ok", redis: "ok", admins: 1, workerVersion: heartbeat, weeklyChallenges: { enabled: true }, weeklyChallengeQueue: { schedulerConfigured: true }, operationalIssues: ["当前周挑战周期缺失"] });
  });

  it("returns a bounded failure when a worker dependency never answers", async () => {
    let release!: (value: typeof heartbeat) => void;
    mocks.worker.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const { GET } = await import("@/app/api/health/route");
    let settled = false;
    const response = GET().then((value) => { settled = true; return value; });
    try {
      await vi.advanceTimersByTimeAsync(2500);
      expect(settled).toBe(true);
      expect((await response).status).toBe(503);
    } finally { release(heartbeat); await response; }
  });

  it("retains healthy dependency evidence even when the database probe fails", async () => {
    mocks.database.mockRejectedValue(new Error("private database failure detail"));
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ database: "unavailable", worker: "ok", queue: { waiting: 0 } });
    expect(JSON.stringify(body)).not.toContain("private database");
  });
});

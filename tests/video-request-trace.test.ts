import { afterEach, describe, expect, it, vi } from "vitest";
const queueMock = vi.hoisted(() => ({ add: vi.fn(), getJob: vi.fn(async () => null), close: vi.fn() }));
vi.mock("bullmq", () => ({ Queue: class { add = queueMock.add; getJob = queueMock.getJob; close = queueMock.close; } }));
vi.mock("../lib/db", () => ({ db: { videoSubmission: { findUnique: vi.fn(async () => ({ id: "synthetic-video", status: "PROCESSING", processingState: null })) } } }));
import { enqueueVideo, closeVideoQueue } from "../lib/video-jobs";
import { requestContext, safeRequestId } from "../lib/request-context";
describe("video request trace propagation", () => {
  afterEach(async () => { await closeVideoQueue(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it("carries the server request trace into job data without changing job deduplication", async () => {
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379/15");
    const trace = "e1f1f1f1-a123-4a45-8def-000000000001";
    await requestContext.run({ id: trace }, () => enqueueVideo("synthetic-video"));
    expect(queueMock.add).toHaveBeenCalledWith("fetch", { videoId: "synthetic-video", requestId: trace }, expect.objectContaining({ jobId: "video-synthetic-video" }));
    expect(safeRequestId(trace)).toBe(trace);
    expect(safeRequestId("private-user-cookie")).toBeNull();
    expect(safeRequestId(null)).toBeNull();
  });
});

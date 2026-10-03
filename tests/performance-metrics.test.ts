import { describe, expect, it } from "vitest";
import { bucketIndex, metricDefinition, summarizeHistogram, validateRum } from "../lib/performance-metric-model";

describe("bounded performance measurements", () => {
  it("rejects unbounded labels and private browser payloads", () => {
    expect(metricDefinition("/api/users/secret?token=abc")).toBeNull();
    expect(validateRum({ name: "LCP", page: "member", viewport: "mobile", value: 2500 })).toBeTruthy();
    expect(validateRum({ name: "LCP", page: "member", viewport: "mobile", value: 2500, url: "private" })).toBeNull();
    expect(validateRum({ name: "LCP", page: "member/123", viewport: "mobile", value: 2500 })).toBeNull();
    expect(validateRum({ name: "CLS", page: "member", viewport: "mobile", value: -1 })).toBeNull();
    expect(validateRum({ name: "LCP", page: "member", viewport: "mobile", value: Infinity })).toBeNull();
  });
  it("reports bucket intervals and unknown empty percentiles, never exact invented latency", () => {
    const bounds = [100, 500, 1000, Infinity];
    expect(bucketIndex(100, bounds)).toBe(0);
    expect(bucketIndex(101, bounds)).toBe(1);
    expect(summarizeHistogram([0, 0, 0, 0], bounds, 0, 0).p95).toBeNull();
    const result = summarizeHistogram([50, 40, 9, 1], bounds, 30_000, 3);
    expect(result.count).toBe(100);
    expect(result.mean).toBe(300);
    expect(result.p50).toEqual({ lower: 0, upper: 100 });
    expect(result.p95).toEqual({ lower: 500, upper: 1000 });
    expect(result.errorRate).toBe(0.03);
    expect(summarizeHistogram([0, 0, 0, 1], bounds, 9000, 0).p95).toEqual({ lower: 1000, upper: null });
  });
});

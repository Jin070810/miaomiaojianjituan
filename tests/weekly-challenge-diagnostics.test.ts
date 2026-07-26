import { describe, expect, it } from "vitest";
import {
  generationFailureCategory,
  summarizeGenerationAttempts,
} from "@/lib/weekly-challenge-diagnostics";
import { z } from "zod";

describe("周挑战匿名生成诊断", () => {
  it("classifies provider and validation failures without returning raw details", () => {
    const sensitiveDetail = "成员 0123456789abcdefabcd 的内部任务正文";
    const summary = summarizeGenerationAttempts([
      {
        batchNumber: 0,
        status: "FAILED",
        latencyMs: 75_001,
        inputTokens: null,
        outputTokens: null,
        error: "This operation was aborted",
      },
      {
        batchNumber: 0,
        status: "SUCCEEDED",
        latencyMs: 51_000,
        inputTokens: 3_200,
        outputTokens: 4_100,
        error: null,
      },
      {
        batchNumber: 1,
        status: "FAILED",
        latencyMs: 20_000,
        inputTokens: null,
        outputTokens: null,
        error: `Number must be greater than 0 ${sensitiveDetail}`,
      },
    ]);
    expect(summary).toMatchObject({
      attempts: 3,
      succeededAttempts: 1,
      failedAttempts: 2,
      runningAttempts: 0,
      finalFailedBatches: [1],
      failureCategories: { timeout: 1, schema_validation: 1 },
      maximumLatencyMs: 75_001,
      inputTokens: 3_200,
      outputTokens: 4_100,
      totalTokens: 7_300,
    });
    expect(JSON.stringify(summary)).not.toContain(sensitiveDetail);
  });

  it("keeps actionable failure categories stable", () => {
    expect(generationFailureCategory(new Error("DeepSeek HTTP 429"))).toBe("provider_http");
    expect(generationFailureCategory(z.enum(["VIDEO_COUNT"]).safeParse("UNKNOWN").error)).toBe("schema_validation");
    expect(generationFailureCategory(new Error("DeepSeek 返回了重复或缺失的成员任务"))).toBe("coverage");
    expect(generationFailureCategory(new Error("成员目标越界"))).toBe("business_validation");
    expect(generationFailureCategory(new Error("成员的视频基线判断超过历史峰值"))).toBe("business_validation");
    expect(generationFailureCategory(new Error("周挑战生成租约已失效"))).toBe("lease_lost");
    expect(generationFailureCategory(new Error("缺少 DEEPSEEK_API_KEY"))).toBe("configuration");
  });
});

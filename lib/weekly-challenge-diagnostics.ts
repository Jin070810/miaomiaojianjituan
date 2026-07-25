type GenerationAttemptSnapshot = {
  batchNumber: number;
  status: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
};

export function generationFailureCategory(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (error instanceof SyntaxError || /unexpected token|invalid json|非法 json/i.test(message)) return "parse";
  if (error instanceof Error && error.name === "ZodError") return "schema_validation";
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  if (/aborted|aborterror|timeout|超时/i.test(message)) return "timeout";
  if (/deepseek http/i.test(message)) return "provider_http";
  if (/重复或缺失|缺少成员|未知成员/i.test(message)) return "coverage";
  if (/zod|invalid enum|invalid_(?:type|value)|number must|string must|too_small|too_big/i.test(message)) {
    return "schema_validation";
  }
  if (/目标越界|目标不应存在|至少 2 条通过视频/i.test(message)) return "business_validation";
  if (/截止时间/i.test(message)) return "deadline";
  if (/租约已失效/i.test(message)) return "lease_lost";
  if (/配置不完整|缺少 (database_url|deepseek_|alert_)/i.test(message)) return "configuration";
  return "generation";
}

export function summarizeGenerationAttempts(attempts: GenerationAttemptSnapshot[]) {
  const succeededBatches = new Set(
    attempts.filter((attempt) => attempt.status === "SUCCEEDED").map((attempt) => attempt.batchNumber),
  );
  const finalFailedBatches = [...new Set(
    attempts
      .filter((attempt) => attempt.status === "FAILED" && !succeededBatches.has(attempt.batchNumber))
      .map((attempt) => attempt.batchNumber),
  )].sort((left, right) => left - right);
  const failureCategories = attempts
    .filter((attempt) => attempt.status === "FAILED")
    .reduce<Record<string, number>>((result, attempt) => {
      const category = generationFailureCategory(attempt.error);
      result[category] = (result[category] ?? 0) + 1;
      return result;
    }, {});
  const latencies = attempts
    .map((attempt) => attempt.latencyMs)
    .filter((latency): latency is number => latency !== null);
  const inputTokens = attempts.reduce((sum, attempt) => sum + (attempt.inputTokens ?? 0), 0);
  const outputTokens = attempts.reduce((sum, attempt) => sum + (attempt.outputTokens ?? 0), 0);
  return {
    attempts: attempts.length,
    succeededAttempts: attempts.filter((attempt) => attempt.status === "SUCCEEDED").length,
    failedAttempts: attempts.filter((attempt) => attempt.status === "FAILED").length,
    runningAttempts: attempts.filter((attempt) => attempt.status === "RUNNING").length,
    finalFailedBatches,
    failureCategories,
    maximumLatencyMs: latencies.length ? Math.max(...latencies) : null,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

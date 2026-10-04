import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { requestContext } from "./request-context";
import type { ApiMetric } from "./performance-metric-model";
import { recordPerformance, recordProcessResources } from "./performance-store";

let logMinute = -1;
let logCount = 0;
export function observeApi<Args extends unknown[], Result extends Response>(key: ApiMetric, handler: (...args: Args) => Promise<Result>) {
  return async (...args: Args): Promise<Result> => {
    const id = randomUUID();
    const start = performance.now();
    let status = 500;
    return requestContext.run({ id }, async () => {
      try {
        const response = await handler(...args);
        status = response.status;
        try {
          response.headers.set("x-request-id", id);
          response.headers.set("server-timing", "app;dur=" + (performance.now() - start).toFixed(1));
        } catch { /* Immutable redirect responses still preserve their original behavior. */ }
        return response;
      } finally {
        const elapsed = Math.max(0, performance.now() - start);
        // The request completes before Redis work; loss is preferable to blocking business.
        try { after(async () => {
          try {
            await recordPerformance(key, elapsed, status >= 500);
            await recordProcessResources("web");
          } catch { /* Metrics must never turn a successful operation into an error. */ }
        }); } catch { /* No request context (e.g. direct unit invocation): skip telemetry. */ }
        if (elapsed >= 1000 || status >= 500) {
          const minute = Math.floor(Date.now() / 60000);
          if (minute !== logMinute) { logMinute = minute; logCount = 0; }
          if (++logCount <= 60) console.info(JSON.stringify({ event: "api_performance", requestId: id, route: key, status, durationMs: Math.round(elapsed) }));
        }
      }
    });
  };
}

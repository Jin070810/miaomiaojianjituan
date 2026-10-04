"use client";
import { useCallback, useEffect, useRef } from "react";
import { useReportWebVitals } from "next/web-vitals";
import { RUM_NAMES, type RumPayload } from "@/lib/performance-metric-model";
export function PerformanceReporter() {
  const context = useRef<{ sampled: boolean; page: RumPayload["page"]; viewport: RumPayload["viewport"]; sent: Set<string> } | null>(null);
  useEffect(() => {
    if (!context.current) {
      const path = window.location.pathname;
      context.current = {
        sampled: Math.random() < 0.2,
        page: path === "/login" ? "login" : path === "/admin" || path.startsWith("/admin/") ? "admin" : path === "/" || path === "/member" || path.startsWith("/member/") ? "member" : "other",
        viewport: window.innerWidth < 768 ? "mobile" : "desktop", sent: new Set(),
      };
    }
  }, []);
  const report = useCallback((metric: { id: string; name: string; value: number }) => {
    const ctx = context.current;
    if (!ctx || !ctx.sampled || !(RUM_NAMES as readonly string[]).includes(metric.name) || ctx.sent.has(metric.id) || ctx.sent.size >= 16) return;
    ctx.sent.add(metric.id);
    void fetch("/api/performance", {
      method: "POST", credentials: "omit", keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: metric.name, page: ctx.page, viewport: ctx.viewport, value: metric.value }),
    }).catch(() => undefined);
  }, []);
  useReportWebVitals(report);
  return null;
}

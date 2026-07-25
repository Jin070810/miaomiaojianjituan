import { describe, expect, it, vi } from "vitest";
import { AdminFetchError, loadAdminSection } from "@/app/admin/admin-loader";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("admin section loader", () => {
  it("loads only the overview endpoint for the initial section", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ metrics: {} })) as unknown as typeof fetch;
    const result = await loadAdminSection("overview", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/admin/dashboard", { cache: "no-store" });
    expect(result).toEqual({ dashboard: { metrics: {} } });
  });

  it("loads the two video resources without requesting unrelated modules", async () => {
    const paths: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      paths.push(String(input));
      return jsonResponse(String(input).includes("appeals") ? { appeals: [] } : { videos: [] });
    }) as unknown as typeof fetch;
    const result = await loadAdminSection("videos", fetcher);
    expect(paths.sort()).toEqual(["/api/admin/video-appeals?take=50", "/api/admin/videos?take=50"].sort());
    expect(result).toEqual({ videos: { videos: [] }, appeals: { appeals: [] } });
  });

  it("uses 50-member pages for selection-backed modules", async () => {
    const paths: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      paths.push(String(input));
      return jsonResponse({});
    }) as unknown as typeof fetch;
    await loadAdminSection("points", fetcher);
    expect(paths).toContain("/api/admin/users?take=50");
    expect(paths.some((value) => value.includes("take=10000"))).toBe(false);
  });

  it("preserves authorization status for page-level redirect handling", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: "无权访问" }, 403)) as unknown as typeof fetch;
    await expect(loadAdminSection("orders", fetcher)).rejects.toMatchObject({ status: 403, message: "无权访问" } satisfies Partial<AdminFetchError>);
  });
});

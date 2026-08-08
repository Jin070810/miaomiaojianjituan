import { describe, expect, it, vi } from "vitest";
import { AdminFetchError, buildAdminUsersPath, loadAdminSection } from "@/app/admin/admin-loader";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("admin section loader", () => {
  it("keeps member search criteria in paginated requests", () => {
    expect(buildAdminUsersPath({ page: 2, take: 50, search: "  member 51  " }))
      .toBe("/api/admin/users?page=2&take=50&search=member+51");
  });
  it("loads only the overview endpoint for the initial section", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ metrics: {} })) as unknown as typeof fetch;
    const result = await loadAdminSection("overview", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/admin/dashboard", { cache: "no-store" });
    expect(result).toEqual({ dashboard: { metrics: {} } });
  });

  it("keeps the workbench shell independent from legacy module requests", async () => {
    const fetcher = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    await expect(loadAdminSection("workbench", fetcher)).resolves.toEqual({});
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("loads the video review resources without requesting unrelated modules", async () => {
    const paths: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      paths.push(String(input));
      if (String(input).includes("video-reviews")) return jsonResponse({ reviews: [] });
      return jsonResponse(String(input).includes("appeals") ? { appeals: [] } : { videos: [] });
    }) as unknown as typeof fetch;
    const result = await loadAdminSection("videos", fetcher);
    expect(paths.sort()).toEqual(["/api/admin/video-appeals?take=50", "/api/admin/videos?take=50", "/api/reviewer/video-reviews?take=50"].sort());
    expect(result).toEqual({ reviews: { reviews: [] }, videos: { videos: [] }, appeals: { appeals: [] } });
  });

  it("uses 50-member pages for selection-backed modules", async () => {
    const paths: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      paths.push(String(input));
      return jsonResponse({});
    }) as unknown as typeof fetch;
    await loadAdminSection("points", fetcher);
    expect(paths).toContain("/api/admin/users?page=1&take=50");
    expect(paths.some((value) => value.includes("take=10000"))).toBe(false);
  });

  it("loads compact order pages and ranking summaries", async () => {
    const paths: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      paths.push(String(input));
      return jsonResponse({});
    }) as unknown as typeof fetch;
    await loadAdminSection("orders", fetcher);
    await loadAdminSection("rankings", fetcher);
    expect(paths).toContain("/api/admin/orders?take=20");
    expect(paths).toContain("/api/admin/rankings?view=summary");
  });

  it("preserves authorization status for page-level redirect handling", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: "无权访问" }, 403)) as unknown as typeof fetch;
    await expect(loadAdminSection("orders", fetcher)).rejects.toMatchObject({ status: 403, message: "无权访问" } satisfies Partial<AdminFetchError>);
  });
});

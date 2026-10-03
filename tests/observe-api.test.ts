import { beforeEach, describe, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ callbacks: [] as Array<() => Promise<void>>, record: vi.fn(), resource: vi.fn() }));
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => hooks.callbacks.push(callback), NextResponse: { json: Response.json } }));
vi.mock("../lib/performance-store", () => ({ recordPerformance: hooks.record, recordProcessResources: hooks.resource }));
import { observeApi } from "../lib/observe-api";
import { requestId } from "../lib/security";
describe("API telemetry isolation and correlation", () => {
  beforeEach(() => { hooks.callbacks = []; vi.clearAllMocks(); });
  it("returns the business response before storage and correlates server-generated audit IDs", async () => {
    let auditId = "";
    const wrapped = observeApi("me_get", async () => { auditId = requestId(); return Response.json({ account: "private" }); });
    const response = await wrapped();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ account: "private" });
    expect(response.headers.get("x-request-id")).toBe(auditId);
    expect(response.headers.get("server-timing")).toMatch(/^app;dur=\d/);
    expect(hooks.record).not.toHaveBeenCalled();
    hooks.record.mockRejectedValueOnce(new Error("Redis unavailable with private credentials"));
    await expect(hooks.callbacks[0]()).resolves.toBeUndefined();
  });
  it("keeps concurrent request IDs independent and preserves thrown errors", async () => {
    const wrap = observeApi("home_get", async () => { await Promise.resolve(); return Response.json({ id: requestId() }); });
    const [a, b] = await Promise.all([wrap(), wrap()]);
    expect((await a.json()).id).toBe(a.headers.get("x-request-id"));
    expect((await b.json()).id).toBe(b.headers.get("x-request-id"));
    expect(a.headers.get("x-request-id")).not.toBe(b.headers.get("x-request-id"));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = new Error("private");
    await expect(observeApi("home_get", async () => { throw error; })()).rejects.toBe(error);
    await hooks.callbacks.at(-1)!();
    expect(hooks.record).toHaveBeenLastCalledWith("home_get", expect.any(Number), true);
    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining("private"));
    vi.restoreAllMocks();
  });
  it("does not break immutable redirects", async () => {
    const response = await observeApi("me_get", async () => Response.redirect("https://example.test/login"))();
    expect(response.status).toBe(302);
  });
});

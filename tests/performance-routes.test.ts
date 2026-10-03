import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), record: vi.fn(), snapshot: vi.fn() }));
vi.mock("../lib/auth", () => ({ currentUser: mocks.user }));
vi.mock("../lib/database-performance", () => ({ getDatabasePressure: async () => null }));
vi.mock("../lib/performance-store", () => ({ recordRum: mocks.record, getPerformanceSnapshot: mocks.snapshot }));
import { POST } from "../app/api/performance/route";
import { GET } from "../app/api/admin/performance/route";
const payload = { name: "LCP", page: "member", viewport: "mobile", value: 1234 };
function request(body: unknown, headers: Record<string, string> = {}) { return new Request("https://example.test/api/performance", { method: "POST", headers: { "content-type": "application/json", origin: "https://example.test", ...headers }, body: JSON.stringify(body) }); }
describe("private performance dashboard and anonymous bounded intake", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.record.mockResolvedValue(true); });
  it("enforces administrator RBAC before reading data", async () => {
    for (const user of [null, { role: "MEMBER" }, { role: "REVIEWER" }]) {
      mocks.user.mockResolvedValueOnce(user); expect((await GET()).status).toBe(403);
    }
    expect(mocks.snapshot).not.toHaveBeenCalled();
    mocks.user.mockResolvedValueOnce({ role: "ADMIN" }); mocks.snapshot.mockResolvedValueOnce({ status: "ok", rows: [] });
    const response = await GET();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("accepts only same-origin fixed numeric samples, with no identity lookups", async () => {
    expect((await POST(request(payload))).status).toBe(204);
    expect(mocks.record).toHaveBeenCalledWith(payload);
    expect(mocks.user).not.toHaveBeenCalled();
    expect((await POST(request(payload, { origin: "https://evil.test" }))).status).toBe(403);
    expect((await POST(request({ ...payload, userId: "sensitive" }))).status).toBe(400);
    expect((await POST(request({ ...payload, value: "123" }))).status).toBe(400);
  });
  it("limits actual chunked body size, and loss does not create a browser retry loop", async () => {
    expect((await POST(request({ huge: "a".repeat(2048) }))).status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
    mocks.record.mockResolvedValueOnce(false);
    expect((await POST(request(payload))).status).toBe(204);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), requestMany: vi.fn(), requestCount: vi.fn(), requestOne: vi.fn(), bindingMany: vi.fn(), videoMany: vi.fn(), create: vi.fn(), review: vi.fn(), revoke: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentUser: mocks.currentUser }));
vi.mock("@/lib/db", () => ({ db: { platformBindingRequest: { findMany: mocks.requestMany, count: mocks.requestCount, findUniqueOrThrow: mocks.requestOne }, platformAccountBinding: { findMany: mocks.bindingMany }, videoSubmission: { findMany: mocks.videoMany } } }));
vi.mock("@/lib/rate-limit", async (original) => ({ ...await original<typeof import("@/lib/rate-limit")>(), enforceRateLimit: vi.fn() }));
vi.mock("@/lib/platform-bindings", async (original) => ({ ...await original<typeof import("@/lib/platform-bindings")>(), createPlatformBindingRequest: mocks.create, reviewPlatformBindingRequest: mocks.review, revokePlatformBinding: mocks.revoke }));
import { GET as memberGet, POST as memberPost } from "../app/api/platform-bindings/route";
import { GET as adminGet, POST as adminPost } from "../app/api/admin/platform-bindings/route";

const post = (path: string, data: unknown, origin = "http://localhost") => new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(data) });

describe("platform binding API permissions and data scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser.mockResolvedValue({ id: "member-one", role: "MEMBER" });
    mocks.requestMany.mockResolvedValue([]); mocks.requestCount.mockResolvedValue(0);
    mocks.bindingMany.mockResolvedValue([]); mocks.videoMany.mockResolvedValue([]);
  });

  it("requires authentication and refuses non-admin reads and mutations", async () => {
    expect((await adminGet(new Request("http://localhost/api/admin/platform-bindings"))).status).toBe(403);
    expect((await adminPost(post("/api/admin/platform-bindings", { action: "revoke", bindingId: "other", reason: "not allowed" }))).status).toBe(403);
    expect(mocks.requestMany).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
    mocks.currentUser.mockResolvedValue(null);
    expect((await memberGet()).status).toBe(401);
    expect((await memberPost(post("/api/platform-bindings", { videoId: "v" }))).status).toBe(401);
  });

  it("scopes every member read and excludes administrator proof notes", async () => {
    const response = await memberGet();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    for (const query of [mocks.requestMany, mocks.bindingMany, mocks.videoMany]) expect(query).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "member-one" }) }));
    expect(mocks.requestMany.mock.calls[0][0].select.proofNote).toBeUndefined();
    expect(mocks.requestMany.mock.calls[0][0].select.challenge).toBe(true);
  });

  it("does not accept a user-supplied UID or another user ID", async () => {
    expect((await memberPost(post("/api/platform-bindings", { videoId: "v", authorUid: "forged", userId: "other" }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.create.mockResolvedValue({ id: "request" }); mocks.requestOne.mockResolvedValue({ id: "request", status: "PENDING" });
    expect((await memberPost(post("/api/platform-bindings", { videoId: "v" }))).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "member-one", videoId: "v" }));
  });

  it("omits the expected challenge from the administrator list and bounds pagination", async () => {
    mocks.currentUser.mockResolvedValue({ id: "admin", role: "ADMIN" });
    const response = await adminGet(new Request("http://localhost/api/admin/platform-bindings?take=9999"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const query = mocks.requestMany.mock.calls[0][0];
    expect(query.take).toBe(50); expect(query.select.challenge).toBeUndefined(); expect(query.select.proofNote).toBe(true);
  });

  it("blocks cross-origin writes and missing control attestation", async () => {
    mocks.currentUser.mockResolvedValue({ id: "admin", role: "ADMIN" });
    expect((await adminPost(post("/api/admin/platform-bindings", { action: "approve", requestId: "r" }, "https://other.test"))).status).toBe(400);
    expect((await adminPost(post("/api/admin/platform-bindings", { action: "approve", requestId: "r", proofNote: "A publicly visible profile cannot demonstrate account control." }))).status).toBe(400);
    expect(mocks.review).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentUser: mocks.user }));
vi.mock("@/lib/member-achievements", () => ({ getMemberAchievements: mocks.read }));
import { GET } from "@/app/api/member/achievements/route";

describe("achievement read endpoint", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });
  it("requires a session before reading a member archive", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("keeps a member response private and forwards projection status", async () => {
    mocks.user.mockResolvedValue({ id: "member-one" });
    mocks.read.mockResolvedValue({ projection: { state: "pending", initialized: false }, profile: { experience: 0 } });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).projection).toEqual({ state: "pending", initialized: false });
    expect(mocks.read).toHaveBeenCalledWith("member-one");
  });
  it("does not disclose a database error in the response or diagnostic log", async () => {
    mocks.user.mockResolvedValue({ id: "member-one" });
    mocks.read.mockRejectedValue(new Error("postgresql://synthetic-secret@example.invalid/database"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "成长档案暂时不可用，请稍后重试" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-secret");
  });
});

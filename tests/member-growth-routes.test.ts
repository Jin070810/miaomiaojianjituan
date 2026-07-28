import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  requireAdmin: vi.fn(),
}));
const growthMocks = vi.hoisted(() => ({
  getMemberGrowth: vi.fn(),
  getAdminMemberGrowth: vi.fn(),
}));

vi.mock("@/lib/auth", () => authMocks);
vi.mock("@/lib/member-growth", () => growthMocks);

import { GET as getMemberGrowthRoute } from "@/app/api/member/growth/route";
import { GET as getAdminDashboardRoute } from "@/app/api/admin/dashboard/route";

describe("member growth route access", () => {
  beforeEach(() => {
    authMocks.currentUser.mockReset();
    authMocks.requireAdmin.mockReset();
    growthMocks.getMemberGrowth.mockReset();
    growthMocks.getAdminMemberGrowth.mockReset();
  });

  it("returns 401 when the member has no authenticated session", async () => {
    authMocks.currentUser.mockResolvedValue(null);
    const response = await getMemberGrowthRoute();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "请先登录" });
    expect(growthMocks.getMemberGrowth).not.toHaveBeenCalled();
  });

  it("returns only the authenticated member's computed growth payload", async () => {
    authMocks.currentUser.mockResolvedValue({ id: "member-1" });
    growthMocks.getMemberGrowth.mockResolvedValue({ timezone: "Asia/Shanghai", trend: [] });
    const response = await getMemberGrowthRoute();
    expect(response.status).toBe(200);
    expect(growthMocks.getMemberGrowth).toHaveBeenCalledWith("member-1");
    expect(await response.json()).toMatchObject({ timezone: "Asia/Shanghai" });
  });

  it("keeps the admin dashboard behind server-side RBAC", async () => {
    authMocks.requireAdmin.mockRejectedValue(new Error("无权执行此操作"));
    const response = await getAdminDashboardRoute();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "无权执行此操作" });
    expect(growthMocks.getAdminMemberGrowth).not.toHaveBeenCalled();
  });
});

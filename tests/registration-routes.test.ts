import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ requireRegistrationApprover: vi.fn(), requireAdmin: vi.fn() }));
const registrationMocks = vi.hoisted(() => ({ registrationApplicationStatuses: ["PENDING", "APPROVED", "REJECTED"], listRegistrationApplications: vi.fn(), reviewRegistrationApplication: vi.fn(), getRegistrationInviteLink: vi.fn(), createRegistrationInviteLink: vi.fn(), revokeRegistrationInviteLink: vi.fn() }));
const securityMocks = vi.hoisted(() => ({ assertSameOrigin: vi.fn(), getClientIp: vi.fn(() => "198.51.100.15"), requestId: vi.fn(() => "registration-request") }));

vi.mock("@/lib/auth", () => authMocks);
vi.mock("@/lib/registration", () => registrationMocks);
vi.mock("@/lib/security", () => securityMocks);

import { GET as list } from "@/app/api/registration-support/applications/route";
import { PATCH as review } from "@/app/api/registration-support/applications/[id]/route";

describe("入团申请审核接口", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMocks.requireRegistrationApprover.mockResolvedValue({ id: "reviewer-1", role: "REVIEWER" });
    registrationMocks.listRegistrationApplications.mockResolvedValue([]);
    registrationMocks.reviewRegistrationApplication.mockResolvedValue({ status: "REJECTED", applicationId: "application-1", idempotent: false });
  });

  it("does not expose applications to ordinary members", async () => {
    authMocks.requireRegistrationApprover.mockRejectedValue(new Error("无权执行此操作"));
    const response = await list(new Request("https://miaoyi.site/api/registration-support/applications"));
    expect(response.status).toBe(403);
    expect(registrationMocks.listRegistrationApplications).not.toHaveBeenCalled();
  });

  it("allows a reviewer to reject with a reason", async () => {
    const response = await review(new Request("https://miaoyi.site/api/registration-support/applications/application-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "REJECT", reason: "请补充有效的公会信息" }),
    }), { params: Promise.resolve({ id: "application-1" }) });
    expect(response.status).toBe(200);
    expect(registrationMocks.reviewRegistrationApplication).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: "application-1",
      action: "REJECT",
      reason: "请补充有效的公会信息",
      reviewer: { id: "reviewer-1", role: "REVIEWER" },
    }));
  });

  it("passes approval through the same reviewer boundary", async () => {
    authMocks.requireRegistrationApprover.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    const response = await review(new Request("https://miaoyi.site/api/registration-support/applications/application-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "APPROVE" }),
    }), { params: Promise.resolve({ id: "application-1" }) });
    expect(response.status).toBe(200);
    expect(registrationMocks.reviewRegistrationApplication).toHaveBeenCalledWith(expect.objectContaining({ action: "APPROVE", reviewer: { id: "admin-1", role: "ADMIN" } }));
  });
});

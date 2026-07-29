import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ requirePasswordResetApprover: vi.fn() }));
const resetMocks = vi.hoisted(() => ({ listPendingPasswordResetRequests: vi.fn(), reviewPasswordResetRequest: vi.fn() }));
const rateMocks = vi.hoisted(() => ({ enforceRateLimit: vi.fn() }));
const securityMocks = vi.hoisted(() => ({
  assertSameOrigin: vi.fn(),
  getClientIp: vi.fn(() => "198.51.100.1"),
  rateLimitResponse: vi.fn(() => null),
  requestId: vi.fn(() => "request-id"),
}));

vi.mock("@/lib/auth", () => authMocks);
vi.mock("@/lib/password-reset-requests", () => resetMocks);
vi.mock("@/lib/rate-limit", () => rateMocks);
vi.mock("@/lib/security", () => securityMocks);

import { GET } from "@/app/api/password-support/requests/route";
import { POST } from "@/app/api/password-support/requests/[id]/route";

describe("密码协助中心接口", () => {
  beforeEach(() => vi.resetAllMocks());

  it("does not expose the pending list without approver authorization", async () => {
    authMocks.requirePasswordResetApprover.mockRejectedValue(new Error("无权执行此操作"));
    const response = await GET();
    expect(response.status).toBe(403);
    expect(resetMocks.listPendingPasswordResetRequests).not.toHaveBeenCalled();
  });

  it("allows a reviewer to approve a request through the isolated support endpoint", async () => {
    authMocks.requirePasswordResetApprover.mockResolvedValue({ id: "reviewer-1", role: "REVIEWER" });
    resetMocks.reviewPasswordResetRequest.mockResolvedValue({ status: "APPROVED" });
    const response = await POST(new Request("http://localhost/api/password-support/requests/reset-1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "APPROVE" }),
    }), { params: Promise.resolve({ id: "reset-1" }) });
    expect(response.status).toBe(200);
    expect(resetMocks.reviewPasswordResetRequest).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "reset-1",
      action: "APPROVE",
      approver: { id: "reviewer-1", role: "REVIEWER" },
    }));
  });
});

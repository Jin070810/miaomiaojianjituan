import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ requireVideoReviewOperator: vi.fn() }));
const dbMocks = vi.hoisted(() => ({
  db: {
    videoSecondaryReview: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));
const pointsMocks = vi.hoisted(() => ({ resolveVideoSecondaryReview: vi.fn() }));
const rateMocks = vi.hoisted(() => ({ enforceRateLimit: vi.fn() }));
const securityMocks = vi.hoisted(() => ({
  assertSameOrigin: vi.fn(),
  getClientIp: vi.fn(() => "198.51.100.20"),
  rateLimitResponse: vi.fn(() => null),
}));

vi.mock("@/lib/auth", () => authMocks);
vi.mock("@/lib/db", () => dbMocks);
vi.mock("@/lib/points", () => pointsMocks);
vi.mock("@/lib/rate-limit", () => rateMocks);
vi.mock("@/lib/security", () => securityMocks);

import { GET } from "@/app/api/reviewer/video-reviews/route";
import { POST } from "@/app/api/reviewer/video-reviews/[id]/route";

describe("视频二次审核接口", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    dbMocks.db.videoSecondaryReview.findMany.mockResolvedValue([]);
    dbMocks.db.videoSecondaryReview.count.mockResolvedValue(0);
    dbMocks.db.videoSecondaryReview.findUnique.mockResolvedValue({ id: "review-1", status: "APPROVED" });
  });

  it("does not expose reviews to ordinary members", async () => {
    authMocks.requireVideoReviewOperator.mockRejectedValue(new Error("无权执行此操作"));
    const response = await GET(new Request("http://localhost/api/reviewer/video-reviews"));
    expect(response.status).toBe(403);
    expect(dbMocks.db.videoSecondaryReview.findMany).not.toHaveBeenCalled();
  });

  it("scopes reviewer review lists to their assigned tasks", async () => {
    authMocks.requireVideoReviewOperator.mockResolvedValue({ id: "reviewer-1", role: "REVIEWER" });
    const response = await GET(new Request("http://localhost/api/reviewer/video-reviews?status=PENDING"));
    expect(response.status).toBe(200);
    expect(dbMocks.db.videoSecondaryReview.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "PENDING", reviewerId: "reviewer-1" },
    }));
  });

  it("lets administrators list all pending secondary reviews", async () => {
    authMocks.requireVideoReviewOperator.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    const response = await GET(new Request("http://localhost/api/reviewer/video-reviews?status=PENDING"));
    expect(response.status).toBe(200);
    expect(dbMocks.db.videoSecondaryReview.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "PENDING" },
    }));
  });

  it("passes reviewer actions through the transactional resolver", async () => {
    authMocks.requireVideoReviewOperator.mockResolvedValue({ id: "reviewer-1", role: "REVIEWER" });
    pointsMocks.resolveVideoSecondaryReview.mockResolvedValue({ id: "review-1", status: "APPROVED" });
    const response = await POST(new Request("http://localhost/api/reviewer/video-reviews/review-1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    }), { params: Promise.resolve({ id: "review-1" }) });
    expect(response.status).toBe(200);
    expect(pointsMocks.resolveVideoSecondaryReview).toHaveBeenCalledWith(expect.objectContaining({
      reviewId: "review-1",
      action: "approve",
      actorId: "reviewer-1",
      actorRole: "REVIEWER",
    }));
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ currentUser: vi.fn() }));
const dbMocks = vi.hoisted(() => ({
  pointLedger: { findMany: vi.fn() },
  videoSubmission: { groupBy: vi.fn(), count: vi.fn() },
  pointAccount: { count: vi.fn() },
  memberEligibility: { findUnique: vi.fn() },
  memberBirthdayProfile: { findUnique: vi.fn() },
  birthdayAnnualBenefit: { findFirst: vi.fn() },
}));

vi.mock("@/lib/auth", () => authMocks);
vi.mock("@/lib/db", () => ({ db: dbMocks }));

import { GET } from "@/app/api/member/home/route";

describe("member home route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("requires an authenticated member", async () => {
    authMocks.currentUser.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "请先登录" });
  });

  it("returns only the current member's safe first-screen data", async () => {
    authMocks.currentUser.mockResolvedValue({
      id: "member-1", kuaishouId: "MiaoOne", nickname: "妙妙", avatarUrl: "/avatars/member.webp", role: "MEMBER", guildStatus: "已入会", invited: true,
      account: { id: "account-1", balance: 880 }, passwordHash: "must-not-leak",
    });
    dbMocks.pointLedger.findMany.mockResolvedValue([{ id: "ledger-1", amount: 50, note: "视频奖励", createdAt: new Date("2026-07-29T00:00:00.000Z") }]);
    dbMocks.videoSubmission.groupBy.mockResolvedValue([{ status: "APPROVED", _count: { id: 2 } }, { status: "REJECTED", _count: { id: 1 } }]);
    dbMocks.pointAccount.count.mockResolvedValue(4);
    dbMocks.videoSubmission.count.mockResolvedValue(12);
    dbMocks.memberEligibility.findUnique.mockResolvedValue(null);
    dbMocks.memberBirthdayProfile.findUnique.mockResolvedValue(null);
    dbMocks.birthdayAnnualBenefit.findFirst.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      user: { id: "member-1", kuaishouId: "MiaoOne", nickname: "妙妙", balance: 880 },
      summary: { approvedVideos: 2, rank: 5, videoCounts: { all: 3, approved: 2, processing: 0, exception: 1 } },
      ledger: [{ id: "ledger-1", amount: 50 }],
      birthday: { registered: false, effective: false, visibleOnWall: false, benefit: null },
    });
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(dbMocks.videoSubmission.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "member-1" } }));
    expect(dbMocks.videoSubmission.count).not.toHaveBeenCalled();
  });

  it("keeps eligibility and birthday data compatible when no account or videos exist", async () => {
    authMocks.currentUser.mockResolvedValue({ id: "member-2", kuaishouId: "NoAccount", nickname: "新成员", role: "MEMBER", avatarUrl: null, invited: false, guildStatus: null, account: null });
    dbMocks.videoSubmission.groupBy.mockResolvedValue([]);
    dbMocks.pointAccount.count.mockResolvedValue(3);
    dbMocks.memberEligibility.findUnique.mockResolvedValue({ status: "ACTIVE", lastOutputAt: null, cycleStartedAt: new Date("2026-09-01T00:00:00Z"), onboardingSeenAt: null,
      policyVersion: { inactivityDays: 30, warningDays: [14, 3], cooldownDays: 7 } });
    dbMocks.memberBirthdayProfile.findUnique.mockResolvedValue({ birthMonth: 10, birthDay: 4, pendingEffectiveAt: null, visibleOnWall: true });
    const prize = { id: "birthday-prize", kind: "POINTS", status: "CLAIMED", points: 20, claimExpiresAt: null };
    dbMocks.birthdayAnnualBenefit.findFirst.mockResolvedValue({ benefitYear: 2026, drawOpensAt: new Date("2026-10-04T00:00:00Z"), drawClosesAt: new Date("2026-10-05T00:00:00Z"), prize });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { balance: 0 }, ledger: [], summary: { approvedVideos: 0, rank: 4, videoCounts: { all: 0, approved: 0, processing: 0, exception: 0 } },
      eligibility: { status: "ACTIVE", deadlineAt: "2026-10-01T00:00:00.000Z", warningDays: [14, 3], inactivityDays: 30, cooldownDays: 7, onboardingSeenAt: null },
      birthday: { registered: true, effective: true, pendingEffectiveAt: null, visibleOnWall: true,
        benefit: { benefitYear: 2026, drawOpensAt: "2026-10-04T00:00:00.000Z", drawClosesAt: "2026-10-05T00:00:00.000Z", prize } },
    });
    expect(dbMocks.pointLedger.findMany).not.toHaveBeenCalled();
    expect(dbMocks.videoSubmission.count).not.toHaveBeenCalled();
  });
});

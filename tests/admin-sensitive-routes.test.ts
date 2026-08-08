import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ writeAuditLog: vi.fn() }));
const rankingMocks = vi.hoisted(() => ({ listSettlementPeriods: vi.fn(), previewRankingPeriod: vi.fn(), settleRankingPeriod: vi.fn() }));
const securityMocks = vi.hoisted(() => ({
  assertSameOrigin: vi.fn(),
  decryptSensitive: vi.fn((value: string) => `decrypted:${value}`),
  getClientIp: vi.fn(() => "198.51.100.8"),
}));
const dbMocks = vi.hoisted(() => {
  const tx = { rankingAward: { findUnique: vi.fn() } };
  return {
    tx,
    db: {
      rankingPeriod: { findMany: vi.fn() },
      redemptionOrder: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
});

vi.mock("@/lib/auth", () => authMocks);
vi.mock("@/lib/audit", () => auditMocks);
vi.mock("@/lib/db", () => ({ db: dbMocks.db }));
vi.mock("@/lib/rankings", () => rankingMocks);
vi.mock("@/lib/security", () => securityMocks);

import { GET as getOrders } from "@/app/api/admin/orders/route";
import { GET as getRankings } from "@/app/api/admin/rankings/route";
import { GET as getAwardDetails } from "@/app/api/admin/rankings/awards/[id]/route";

describe("admin sensitive list routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMocks.requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    rankingMocks.listSettlementPeriods.mockResolvedValue([]);
    dbMocks.db.redemptionOrder.findMany.mockResolvedValue([]);
    dbMocks.db.redemptionOrder.count.mockResolvedValue(0);
    dbMocks.db.redemptionOrder.groupBy.mockResolvedValue([]);
  });

  it("returns numeric order counts independent of the active status filter", async () => {
    dbMocks.db.redemptionOrder.count.mockResolvedValue(4);
    dbMocks.db.redemptionOrder.groupBy.mockResolvedValue([
      { status: "PENDING", _count: { _all: 2 } },
      { status: "APPROVED", _count: { _all: 1 } },
      { status: "FULFILLED", _count: { _all: 5 } },
      { status: "REFUNDED", _count: { _all: 1 } },
    ]);
    const response = await getOrders(new Request("http://localhost/api/admin/orders?status=PENDING_SHIPMENT&take=20"));
    expect(response.status).toBe(200);
    expect((await response.json()).statusCounts).toEqual({ all: 9, pending: 3, fulfilled: 5 });
    expect(dbMocks.db.redemptionOrder.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it("does not decrypt or return recipient plaintext in ranking summaries", async () => {
    dbMocks.db.rankingPeriod.findMany.mockResolvedValue([{
      id: "period-1",
      status: "SETTLED",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      entries: [],
      awards: [{
        id: "award-1",
        recipientName: "收件人",
        recipientPhoneEnc: "phone-cipher",
        recipientAddressEnc: "address-cipher",
        user: { nickname: "成员", kuaishouId: "member-1" },
        gift: null,
      }],
    }]);
    const response = await getRankings(new Request("http://localhost/api/admin/rankings?view=summary"));
    const body = await response.json();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.periods[0].awards[0]).toMatchObject({ recipientName: null, recipientPhone: null, recipientAddress: null, hasRecipientDetails: true });
    expect(JSON.stringify(body)).not.toContain("phone-cipher");
    expect(JSON.stringify(body)).not.toContain("address-cipher");
    expect(securityMocks.decryptSensitive).not.toHaveBeenCalled();
  });

  it("requires admin RBAC before reading award recipient details", async () => {
    authMocks.requireAdmin.mockRejectedValue(new Error("无权访问"));
    const response = await getAwardDetails(new Request("http://localhost/api/admin/rankings/awards/award-1"), { params: Promise.resolve({ id: "award-1" }) });
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(dbMocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("decrypts award details only on demand and writes a view audit", async () => {
    dbMocks.tx.rankingAward.findUnique.mockResolvedValue({ recipientName: "收件人", recipientPhoneEnc: "phone-cipher", recipientAddressEnc: "address-cipher" });
    const response = await getAwardDetails(new Request("http://localhost/api/admin/rankings/awards/award-1"), { params: Promise.resolve({ id: "award-1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).details).toEqual({ recipientName: "收件人", recipientPhone: "decrypted:phone-cipher", recipientAddress: "decrypted:address-cipher" });
    expect(auditMocks.writeAuditLog).toHaveBeenCalledWith(dbMocks.tx, expect.objectContaining({ actorId: "admin-1", action: "RANKING_AWARD_RECIPIENT_VIEWED", entityId: "award-1" }));
  });
});

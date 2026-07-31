import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { listMemberClearanceAdmin, memberClearanceInternals, requestRejoin, reviewRejoin } from "@/lib/member-clearance";

const enabled = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("member clearance database integration", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let userId = "";
  let accountId = "";
  let eligibilityId = "";
  let policyId = "";
  let orderId = "";
  let giftId = "";
  let rejoinRequestId = "";

  beforeAll(async () => {
    const latest = await db.membershipClearancePolicyVersion.aggregate({ _max: { version: true } });
    const policy = await db.membershipClearancePolicyVersion.create({ data: { version: (latest._max.version ?? 0) + 1, inactivityDays: 1, warningDays: [1, 0], cooldownDays: 1 } });
    policyId = policy.id;
    const user = await db.user.create({ data: { kuaishouId: `clearance-${suffix}`, nickname: "清退测试成员", passwordHash: "test", account: { create: { balance: 200 } } }, include: { account: true } });
    userId = user.id;
    accountId = user.account!.id;
    const gift = await db.gift.create({ data: { name: `清退订单-${suffix}`, pointsCost: 100, stock: 0 } });
    giftId = gift.id;
    const order = await db.redemptionOrder.create({ data: { userId, giftId, unitCost: 100, totalCost: 100, status: "APPROVED", idempotencyKey: `clearance-order-${suffix}` } });
    orderId = order.id;
    await db.session.create({ data: { id: `clearance-session-${suffix}`, userId, expiresAt: new Date(Date.now() + 86_400_000) } });
    const eligibility = await db.memberEligibility.create({ data: { userId, policyVersionId: policyId, cycleStartedAt: new Date(Date.now() - 2 * 86_400_000) } });
    eligibilityId = eligibility.id;
  });

  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { entityId: { in: [eligibilityId, rejoinRequestId] } } });
    await db.redemptionOrder.deleteMany({ where: { id: orderId } });
    await db.gift.deleteMany({ where: { id: giftId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.membershipClearancePolicyVersion.deleteMany({ where: { id: policyId } });
    await db.$disconnect();
  });

  it("cancels unfinished orders, refunds then forfeits balance, and restores only after review", async () => {
    const clearanceResults = await Promise.all([
      memberClearanceInternals.clearMember(eligibilityId, new Date()),
      memberClearanceInternals.clearMember(eligibilityId, new Date()),
    ]);
    expect(clearanceResults.filter(Boolean)).toHaveLength(1);
    expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ active: false });
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(await db.redemptionOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: "CLEARANCE_CANCELLED" });
    expect(await db.gift.findUniqueOrThrow({ where: { id: giftId } })).toMatchObject({ stock: 1 });
    expect(await db.pointAccount.findUniqueOrThrow({ where: { id: accountId } })).toMatchObject({ balance: 0 });
    expect(await db.pointLedger.count({ where: { accountId, type: "REDEMPTION_REFUND" } })).toBe(1);
    expect(await db.pointLedger.count({ where: { accountId, type: "MEMBER_CLEARANCE_FORFEIT" } })).toBe(1);
    const clearanceAdmin = await listMemberClearanceAdmin();
    expect(clearanceAdmin.summary.currentClearanceCount).toBeGreaterThan(0);
    expect(clearanceAdmin.clearedMembers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: eligibilityId, status: "COOLDOWN", user: expect.objectContaining({ kuaishouId: `clearance-${suffix}` }) }),
    ]));

    await db.memberEligibility.update({ where: { id: eligibilityId }, data: { cooldownEndsAt: new Date(Date.now() - 1) } });
    const request = await requestRejoin({ userId });
    rejoinRequestId = request.id;
    await reviewRejoin({ requestId: request.id, reviewerId: userId, approved: true });
    expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ active: true });
    expect(await db.memberEligibility.findUniqueOrThrow({ where: { id: eligibilityId } })).toMatchObject({ status: "ACTIVE", cooldownEndsAt: null });
  });
});

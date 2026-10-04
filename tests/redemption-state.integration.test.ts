import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { updateRedemptionOrder } from "@/lib/points";
import { inspectRedemptionReconciliation } from "@/lib/redemption-reconciliation";

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("兑换状态原子转换和生日零价订单", () => {
  const userIds: string[] = [];
  const giftIds: string[] = [];
  const orderIds: string[] = [];
  const suffix = `${Date.now()}-${Math.random()}`;
  let adminId: string;
  let sequence = 0;
  beforeAll(async () => {
    adminId = (await db.user.create({ data: { kuaishouId: `redemption-admin-${suffix}`, nickname: "订单管理员", passwordHash: "test", role: "ADMIN" } })).id;
    userIds.push(adminId);
  });
  afterAll(async () => {
    await db.notification.deleteMany({ where: { userId: { in: userIds } } });
    await db.auditLog.deleteMany({ where: { entity: "RedemptionOrder", entityId: { in: orderIds } } });
    await db.redemptionOrder.deleteMany({ where: { id: { in: orderIds } } });
    await db.birthdayPrize.deleteMany({ where: { annualBenefit: { userId: { in: userIds } } } });
    await db.birthdayAnnualBenefit.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.gift.deleteMany({ where: { id: { in: giftIds } } });
    await db.$disconnect();
  });
  async function orderFixture(birthday: boolean, fulfilled = false) {
    const user = await db.user.create({ data: { kuaishouId: `redemption-${sequence++}-${suffix}`, nickname: "订单成员", passwordHash: "test", account: { create: {} } }, include: { account: true } });
    userIds.push(user.id);
    const gift = await db.gift.create({ data: { name: "订单测试权益", kind: "MEMBERSHIP", pointsCost: 50, stock: 0 } });
    giftIds.push(gift.id);
    let birthdayPrizeId: string | undefined;
    if (birthday) {
      const benefit = await db.birthdayAnnualBenefit.create({ data: { userId: user.id, benefitYear: 2026, occurrenceDate: new Date(), drawOpensAt: new Date(), drawClosesAt: new Date() } });
      birthdayPrizeId = (await db.birthdayPrize.create({ data: { annualBenefitId: benefit.id, kind: "GIFT", status: "CLAIMED", ticket: 99999, giftId: gift.id, drawIdempotencyKey: benefit.id } })).id;
    }
    const order = await db.redemptionOrder.create({ data: { userId: user.id, giftId: gift.id, birthdayPrizeId, quantity: 1, unitCost: birthday ? 0 : 50, totalCost: birthday ? 0 : 50, status: fulfilled ? "FULFILLED" : "PENDING", idempotencyKey: user.id } });
    orderIds.push(order.id);
    if (!birthday) await db.pointLedger.createMany({ data: [
      { accountId: user.account!.id, type: "ADMIN_ADJUSTMENT", amount: 50, balanceAfter: 50 },
      { accountId: user.account!.id, type: "REDEMPTION", amount: -50, balanceAfter: 0, referenceId: order.id },
    ] });
    return { order, gift, user };
  }
  it.each(["reject", "refund"] as const)("cancels a birthday gift with %s once, without zero-value credit or a second claim", async action => {
    const { order, gift, user } = await orderFixture(true, action === "refund");
    const [first, retry] = await Promise.all([
      updateRedemptionOrder({ orderId: order.id, actorId: adminId, action, reason: "生日奖品无法发放" }),
      updateRedemptionOrder({ orderId: order.id, actorId: adminId, action, reason: "生日奖品无法发放" }),
    ]);
    expect(first.status).toBe(action === "refund" ? "REFUNDED" : "REJECTED");
    expect(retry.status).toBe(first.status);
    expect((await db.gift.findUniqueOrThrow({ where: { id: gift.id } })).stock).toBe(1);
    expect((await db.pointAccount.findUniqueOrThrow({ where: { userId: user.id } })).balance).toBe(0);
    expect(await db.pointLedger.count({ where: { referenceId: order.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: order.id, action: action === "refund" ? "REDEMPTION_REFUNDED" : "REDEMPTION_REJECTED" } })).toBe(1);
    expect((await db.birthdayPrize.findUniqueOrThrow({ where: { id: order.birthdayPrizeId! } })).status).toBe("CLAIMED");
    expect((await db.notification.findFirstOrThrow({ where: { userId: user.id, entityId: order.id } })).body).toContain("未扣除积分");
  });
  it("reject replay returns the existing terminal state without restoring stock twice", async () => {
    const { order, gift } = await orderFixture(false);
    await updateRedemptionOrder({ orderId: order.id, actorId: adminId, action: "reject", reason: "库存不可用" });
    await expect(updateRedemptionOrder({ orderId: order.id, actorId: adminId, action: "reject", reason: "库存不可用" })).resolves.toMatchObject({ status: "REJECTED" });
    expect((await db.gift.findUniqueOrThrow({ where: { id: gift.id } })).stock).toBe(1);
    expect(await db.pointLedger.count({ where: { referenceId: order.id, type: "REDEMPTION_REFUND" } })).toBe(1);
  });
  it("does not treat an ordinary malformed zero-price order as a birthday gift", async () => {
    const { order, gift } = await orderFixture(false);
    await db.redemptionOrder.update({ where: { id: order.id }, data: { unitCost: 0, totalCost: 0 } });
    await expect(updateRedemptionOrder({ orderId: order.id, actorId: adminId, action: "reject", reason: "异常订单" })).rejects.toThrow();
    expect((await db.redemptionOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
    expect((await db.gift.findUniqueOrThrow({ where: { id: gift.id } })).stock).toBe(0);
  });
  it("records only one approval and one fulfillment under concurrent retries", async () => {
    const { order } = await orderFixture(false);
    await Promise.all(Array.from({ length: 8 }, () => updateRedemptionOrder({ orderId: order.id, actorId: adminId, action: "approve" })));
    expect(await db.auditLog.count({ where: { entityId: order.id, action: "REDEMPTION_APPROVED" } })).toBe(1);
    await Promise.all(Array.from({ length: 8 }, () => updateRedemptionOrder({ orderId: order.id, actorId: adminId, action: "fulfill" })));
    expect(await db.auditLog.count({ where: { entityId: order.id, action: "REDEMPTION_FULFILLED" } })).toBe(1);
  });
  it("keeps birthday claims out of both paid-order maintenance lists", async () => {
    const { order, gift } = await orderFixture(true);
    const cutoff = new Date(Date.now() + 60_000);
    const matchingGift = await inspectRedemptionReconciliation({ cutoff, excludedGiftName: gift.name });
    const otherGift = await inspectRedemptionReconciliation({ cutoff, excludedGiftName: "different-gift" });
    for (const scope of [matchingGift, otherGift]) {
      expect([...scope.excluded, ...scope.fulfill].map(row => row.id)).not.toContain(order.id);
    }
    expect((await db.redemptionOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
  });
  it.each(["approve", "fulfill"] as const)("a stale %s cannot overwrite a concurrent refund", async action => {
    const { order, gift, user } = await orderFixture(false);
    await Promise.all([
      updateRedemptionOrder({ orderId: order.id, actorId: adminId, action: "refund", reason: "取消兑换" }),
      updateRedemptionOrder({ orderId: order.id, actorId: adminId, action }),
    ]);
    expect((await db.redemptionOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("REFUNDED");
    expect((await db.pointAccount.findUniqueOrThrow({ where: { userId: user.id } })).balance).toBe(50);
    expect((await db.gift.findUniqueOrThrow({ where: { id: gift.id } })).stock).toBe(1);
    expect(await db.pointLedger.count({ where: { referenceId: order.id, type: "REDEMPTION_REFUND" } })).toBe(1);
    const competingAudit = await db.auditLog.findFirst({ where: { entityId: order.id, action: action === "approve" ? "REDEMPTION_APPROVED" : "REDEMPTION_FULFILLED" } });
    const refundAudit = await db.auditLog.findFirstOrThrow({ where: { entityId: order.id, action: "REDEMPTION_REFUNDED" } });
    expect(refundAudit.beforeValue).toMatchObject({ status: competingAudit ? action === "approve" ? "APPROVED" : "FULFILLED" : "PENDING" });
  });
});

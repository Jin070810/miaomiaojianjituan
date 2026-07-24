import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { inspectRedemptionReconciliation, reconcileRedemptionOrders } from "@/lib/redemption-reconciliation";

const enabled = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("兑换订单维护结算", () => {
  let adminId = "";
  let memberId = "";
  let excludedGiftId = "";
  let fulfillGiftId = "";
  let excludedOrderId = "";
  let fulfillOrderId = "";
  let excludedGiftName = "";
  const testCreatedAt = new Date("2000-01-01T00:00:00.000Z");
  const testCutoff = new Date("2000-01-02T00:00:00.000Z");

  beforeAll(async () => {
    const suffix = Date.now().toString();
    const admin = await db.user.create({
      data: { kuaishouId: `reconcile-admin-${suffix}`, nickname: "维护管理员", passwordHash: "test", role: "ADMIN", account: { create: { balance: 0 } } },
    });
    const member = await db.user.create({
      data: { kuaishouId: `reconcile-member-${suffix}`, nickname: "待退款成员", passwordHash: "test", account: { create: { balance: 0 } } },
    });
    adminId = admin.id;
    memberId = member.id;
    excludedGiftName = `悠哈奶糖条-${suffix}`;
    const excludedGift = await db.gift.create({ data: { name: excludedGiftName, pointsCost: 100, stock: 0 } });
    const fulfillGift = await db.gift.create({ data: { name: "测试已发放礼品", pointsCost: 50, stock: 0 } });
    excludedGiftId = excludedGift.id;
    fulfillGiftId = fulfillGift.id;
    const excludedOrder = await db.redemptionOrder.create({
      data: { userId: memberId, giftId: excludedGiftId, unitCost: 100, totalCost: 100, status: "APPROVED", idempotencyKey: `reconcile-excluded-${suffix}`, createdAt: testCreatedAt },
    });
    const fulfillOrder = await db.redemptionOrder.create({
      data: { userId: memberId, giftId: fulfillGiftId, unitCost: 50, totalCost: 50, status: "APPROVED", idempotencyKey: `reconcile-fulfill-${suffix}`, createdAt: testCreatedAt },
    });
    excludedOrderId = excludedOrder.id;
    fulfillOrderId = fulfillOrder.id;
  });

  afterAll(async () => {
    await db.notification.deleteMany({ where: { entityType: "RedemptionOrder", entityId: { in: [excludedOrderId, fulfillOrderId] } } });
    await db.auditLog.deleteMany({ where: { entity: "RedemptionOrder", entityId: { in: [excludedOrderId, fulfillOrderId] } } });
    await db.redemptionOrder.deleteMany({ where: { id: { in: [excludedOrderId, fulfillOrderId] } } });
    await db.gift.deleteMany({ where: { id: { in: [excludedGiftId, fulfillGiftId] } } });
    await db.user.deleteMany({ where: { id: { in: [adminId, memberId] } } });
    await db.$disconnect();
  });

  it("previews, applies atomically, refunds the excluded order, and is retry-safe", async () => {
    const preview = await inspectRedemptionReconciliation({ cutoff: testCutoff, excludedGiftName });
    expect(preview.excluded).toHaveLength(1);
    expect(preview.fulfill.map((order) => order.id)).toContain(fulfillOrderId);

    const result = await reconcileRedemptionOrders({
      actorId: adminId,
      cutoff: testCutoff,
      excludedGiftName,
      reason: "测试：订单资料同步",
    });
    expect(result.fulfilledCount).toBe(1);
    expect(result.refundedPoints).toBe(100);
    expect(await db.redemptionOrder.findUnique({ where: { id: excludedOrderId } }).then((order) => order?.status)).toBe("REJECTED");
    expect(await db.redemptionOrder.findUnique({ where: { id: fulfillOrderId } }).then((order) => order?.status)).toBe("FULFILLED");
    expect(await db.pointAccount.findUnique({ where: { userId: memberId } }).then((account) => account?.balance)).toBe(100);
    expect(await db.pointLedger.count({ where: { idempotencyKey: `maintenance:redemption:${excludedOrderId}:refund` } })).toBe(1);
    expect(await db.notification.count({ where: { entityType: "RedemptionOrder", entityId: excludedOrderId } })).toBe(1);
    expect(await db.notification.count({ where: { entityType: "RedemptionOrder", entityId: fulfillOrderId } })).toBe(1);
    expect(await db.gift.findUnique({ where: { id: excludedGiftId } }).then((gift) => gift?.stock)).toBe(1);
    expect(await db.auditLog.count({ where: { action: "REDEMPTION_RECONCILIATION_COMPLETED", entityId: excludedOrderId } })).toBe(1);

    const retry = await reconcileRedemptionOrders({
      actorId: adminId,
      cutoff: testCutoff,
      excludedGiftName,
      reason: "测试：订单资料同步",
    });
    expect(retry.alreadyApplied).toBe(true);
    expect(await db.pointLedger.count({ where: { idempotencyKey: `maintenance:redemption:${excludedOrderId}:refund` } })).toBe(1);
    expect(await db.notification.count({ where: { entityType: "RedemptionOrder", entityId: { in: [excludedOrderId, fulfillOrderId] } } })).toBe(2);
  });
});

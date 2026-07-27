import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reorderAdminGifts, softDeleteAdminGift } from "@/lib/admin-gifts";
import { db } from "@/lib/db";

const enabled = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("礼品目录事务", () => {
  const giftIds: string[] = [];
  let adminId = "";
  let memberId = "";
  let orderId = "";

  beforeAll(async () => {
    const suffix = Date.now().toString();
    const [admin, member] = await Promise.all([
      db.user.create({ data: { kuaishouId: `gift-admin-${suffix}`, nickname: "礼品管理员", passwordHash: "test", role: "ADMIN" } }),
      db.user.create({ data: { kuaishouId: `gift-member-${suffix}`, nickname: "礼品成员", passwordHash: "test" } }),
    ]);
    adminId = admin.id;
    memberId = member.id;
    for (const [index, name] of ["礼品甲", "礼品乙", "礼品丙"].entries()) {
      const gift = await db.gift.create({ data: { name: `${name}-${suffix}`, pointsCost: 10, stock: 5, displayOrder: 100 + index } });
      giftIds.push(gift.id);
    }
    const order = await db.redemptionOrder.create({
      data: {
        userId: memberId,
        giftId: giftIds[0],
        unitCost: 10,
        totalCost: 10,
        status: "FULFILLED",
        idempotencyKey: `gift-order-${suffix}`,
      },
    });
    orderId = order.id;
  });

  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { OR: [{ actorId: adminId }, { entityId: { in: giftIds } }] } });
    if (orderId) await db.redemptionOrder.deleteMany({ where: { id: orderId } });
    await db.gift.deleteMany({ where: { id: { in: giftIds } } });
    await db.user.deleteMany({ where: { id: { in: [adminId, memberId] } } });
    await db.$disconnect();
  });

  it("reorders the complete visible catalog atomically", async () => {
    const current = await db.gift.findMany({ where: { deletedAt: null }, orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }, { id: "asc" }] });
    const remaining = current.map((gift) => gift.id).filter((id) => !giftIds.includes(id));
    const orderedIds = [giftIds[2], giftIds[0], giftIds[1], ...remaining];
    const reordered = await reorderAdminGifts({ actorId: adminId, orderedIds });
    expect(reordered.slice(0, 3).map((gift) => gift.id)).toEqual(giftIds.length ? [giftIds[2], giftIds[0], giftIds[1]] : []);
    expect(await db.auditLog.count({ where: { actorId: adminId, action: "GIFT_REORDERED" } })).toBe(1);
  });

  it("supports pinning a gift without changing redemption history", async () => {
    await db.gift.update({ where: { id: giftIds[1] }, data: { pinned: true } });
    const visible = await db.gift.findMany({
      where: { deletedAt: null },
      orderBy: [{ pinned: "desc" }, { displayOrder: "asc" }, { createdAt: "desc" }, { id: "asc" }],
      take: 1,
    });
    expect(visible[0]?.id).toBe(giftIds[1]);
    expect(await db.redemptionOrder.findUnique({ where: { id: orderId } })).not.toBeNull();
  });

  it("soft deletes a referenced gift without removing order history", async () => {
    await softDeleteAdminGift({ actorId: adminId, giftId: giftIds[0] });
    const gift = await db.gift.findUniqueOrThrow({ where: { id: giftIds[0] } });
    expect(gift.active).toBe(false);
    expect(gift.deletedAt).not.toBeNull();
    expect(await db.redemptionOrder.findUnique({ where: { id: orderId }, include: { gift: true } }).then((order) => order?.gift.id)).toBe(giftIds[0]);
    expect(await db.auditLog.count({ where: { actorId: adminId, action: "GIFT_DELETED", entityId: giftIds[0] } })).toBe(1);
  });
});

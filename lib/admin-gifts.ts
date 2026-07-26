import { db } from "@/lib/db";

export async function reorderAdminGifts(input: { actorId: string; orderedIds: string[]; ip?: string | null }) {
  return db.$transaction(async (tx) => {
    const current = await tx.gift.findMany({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }, { id: "asc" }],
    });
    const currentIds = current.map((gift) => gift.id);
    if (currentIds.length !== input.orderedIds.length || currentIds.some((id) => !input.orderedIds.includes(id))) {
      throw new Error("礼品排序数据已过期，请刷新后重试");
    }

    await Promise.all(input.orderedIds.map((id, displayOrder) => tx.gift.update({ where: { id }, data: { displayOrder } })));
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "GIFT_REORDERED",
        entity: "Gift",
        afterValue: { orderedIds: input.orderedIds },
        ip: input.ip,
      },
    });
    return tx.gift.findMany({
      where: { deletedAt: null },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }, { id: "asc" }],
    });
  });
}

export async function softDeleteAdminGift(input: { giftId: string; actorId: string; ip?: string | null }) {
  return db.$transaction(async (tx) => {
    const before = await tx.gift.findFirst({ where: { id: input.giftId, deletedAt: null } });
    if (!before) throw new Error("礼品不存在");
    const deleted = await tx.gift.update({
      where: { id: before.id },
      data: { active: false, deletedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "GIFT_DELETED",
        entity: "Gift",
        entityId: before.id,
        beforeValue: {
          name: before.name,
          kind: before.kind,
          pointsCost: before.pointsCost,
          stock: before.stock,
          active: before.active,
          displayOrder: before.displayOrder,
        },
        afterValue: { active: false, deletedAt: deleted.deletedAt },
        ip: input.ip,
      },
    });
    return deleted;
  });
}

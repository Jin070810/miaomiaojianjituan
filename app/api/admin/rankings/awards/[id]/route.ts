import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, getClientIp } from "@/lib/security";

const schema = z.object({
  giftId: z.string().min(1).optional(),
  status: z.enum(["PENDING", "CLAIMED", "FULFILLED", "EXPIRED"]).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const award = await db.$transaction(async (tx) => {
      const before = await tx.rankingAward.findUnique({ where: { id }, include: { gift: true } });
      if (!before) throw new Error("榜单奖励不存在");
      if (before.status === "FULFILLED") throw new Error("已完成的奖励不能修改");
      let nextGiftId = before.giftId;
      if (input.giftId && input.giftId !== before.giftId) {
        const gift = await tx.gift.findUnique({ where: { id: input.giftId } });
        if (!gift || !gift.active) throw new Error("礼品不存在或已下架");
        const reserved = await tx.gift.updateMany({ where: { id: gift.id, stock: { gte: 1 }, active: true }, data: { stock: { decrement: 1 } } });
        if (reserved.count !== 1) throw new Error("礼品库存不足");
        if (before.giftId) await tx.gift.update({ where: { id: before.giftId }, data: { stock: { increment: 1 } } });
        nextGiftId = gift.id;
      }
      const updated = await tx.rankingAward.update({
        where: { id },
        data: { giftId: nextGiftId, ...(input.status ? { status: input.status, ...(input.status === "FULFILLED" ? { fulfilledAt: new Date() } : {}) } : {}) },
        include: { gift: true, user: { select: { kuaishouId: true, nickname: true } }, period: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "RANKING_AWARD_UPDATED",
          entity: "RankingAward",
          entityId: id,
          beforeValue: { giftId: before.giftId, status: before.status },
          afterValue: { giftId: updated.giftId, status: updated.status },
          ip: getClientIp(request),
        },
      });
      return updated;
    });
    return NextResponse.json({ award });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "奖励参数不正确" : error instanceof Error ? error.message : "更新失败" }, { status: 400 });
  }
}

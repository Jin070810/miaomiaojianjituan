import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, decryptSensitive, getClientIp } from "@/lib/security";
import { createNotification } from "@/lib/notifications";
import { writeAuditLog } from "@/lib/audit";

const schema = z.object({
  giftId: z.string().min(1).optional(),
  status: z.enum(["FULFILLED", "EXPIRED"]).optional(),
});
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    const details = await db.$transaction(async (tx) => {
      const award = await tx.rankingAward.findUnique({
        where: { id },
        select: {
          recipientName: true,
          recipientPhoneEnc: true,
          recipientAddressEnc: true,
        },
      });
      if (!award) throw new Error("榜单奖励不存在");
      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "RANKING_AWARD_RECIPIENT_VIEWED",
        entity: "RankingAward",
        entityId: id,
        afterValue: { viewed: true },
        ip: getClientIp(request),
      });
      return {
        recipientName: award.recipientName,
        recipientPhone: award.recipientPhoneEnc ? decryptSensitive(award.recipientPhoneEnc) : null,
        recipientAddress: award.recipientAddressEnc ? decryptSensitive(award.recipientAddressEnc) : null,
      };
    });
    return NextResponse.json({ details }, { headers: privateHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法读取领奖资料";
    return NextResponse.json({ error: message }, { status: message === "榜单奖励不存在" ? 404 : 403, headers: privateHeaders });
  }
}

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
      if (input.giftId && input.giftId !== before.giftId && before.status !== "PENDING") {
        throw new Error("成员已填写领奖资料，不能更换奖励礼品");
      }
      if (input.status === "EXPIRED" && input.giftId && input.giftId !== before.giftId) {
        throw new Error("过期奖励不能同时更换礼品");
      }
      if (input.giftId && input.giftId !== before.giftId) {
        const gift = await tx.gift.findUnique({ where: { id: input.giftId } });
        if (!gift || !gift.active) throw new Error("礼品不存在或已下架");
        const reserved = await tx.gift.updateMany({ where: { id: gift.id, stock: { gte: 1 }, active: true }, data: { stock: { decrement: 1 } } });
        if (reserved.count !== 1) throw new Error("礼品库存不足");
        if (before.giftId) await tx.gift.update({ where: { id: before.giftId }, data: { stock: { increment: 1 } } });
        nextGiftId = gift.id;
      }
      if (input.status === "FULFILLED") {
        if (before.status !== "CLAIMED") throw new Error("只有成员已填写资料的奖励才能完成发放");
        if (!before.recipientName || !before.recipientPhoneEnc || !before.recipientAddressEnc) {
          throw new Error("榜单奖励缺少完整收货资料");
        }
      }
      if (input.status === "EXPIRED" && !["PENDING", "CLAIMED"].includes(before.status)) {
        throw new Error("当前奖励状态不能过期");
      }
      if (input.status === "EXPIRED" && before.giftId) {
        await tx.gift.update({ where: { id: before.giftId }, data: { stock: { increment: 1 } } });
      }
      const updated = await tx.rankingAward.update({
        where: { id },
        data: {
          giftId: nextGiftId,
          ...(input.status ? {
            status: input.status,
            ...(input.status === "FULFILLED" ? { fulfilledAt: new Date() } : { fulfilledAt: null }),
          } : {}),
        },
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
      if (input.status === "FULFILLED") {
        await createNotification(tx, {
          userId: updated.userId,
          type: "RANKING_AWARD",
          title: "榜单奖励已发放",
          body: `第 ${updated.rank} 名奖励已完成发放。`,
          entityType: "RankingAward",
          entityId: updated.id,
          metadata: { status: "FULFILLED", rank: updated.rank },
          dedupeKey: `ranking-award:${updated.id}:fulfilled`,
        });
      }
      return updated;
    });
    return NextResponse.json({ award });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "奖励参数不正确" : error instanceof Error ? error.message : "更新失败" }, { status: 400 });
  }
}

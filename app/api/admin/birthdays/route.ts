import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { birthdayAdminSummary, configureBirthdayPoolItem, extendBirthdayWindow, releaseBirthdayPoolItem, revokeBirthdayPrize } from "@/lib/birthdays";
import { assertSameOrigin, getClientIp } from "@/lib/security";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reserve"), giftId: z.string().min(1), quantity: z.number().int().positive() }),
  z.object({ action: z.literal("release"), poolItemId: z.string().min(1), quantity: z.number().int().positive() }),
  z.object({ action: z.literal("extend_draw"), benefitId: z.string().min(1), days: z.number().int().min(1).max(30), reason: z.string().trim().min(2).max(500) }),
  z.object({ action: z.literal("extend_claim"), prizeId: z.string().min(1), days: z.number().int().min(1).max(30), reason: z.string().trim().min(2).max(500) }),
  z.object({ action: z.literal("revoke_prize"), prizeId: z.string().min(1), reason: z.string().trim().min(2).max(500) }),
]);

export async function GET() {
  try {
    await requireAdmin();
    const [summary, eligibleGifts] = await Promise.all([
      birthdayAdminSummary(),
      db.gift.findMany({ where: { active: true, deletedAt: null, kind: { in: ["PHYSICAL", "MEMBERSHIP"] }, pointsCost: { gte: 10, lte: 2000 } }, select: { id: true, name: true, kind: true, pointsCost: true, stock: true }, orderBy: { pointsCost: "asc" } }),
    ]);
    return NextResponse.json({ ...summary, eligibleGifts });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const input = schema.parse(await request.json());
    const result = input.action === "reserve"
      ? await configureBirthdayPoolItem({ actorId: admin.id, giftId: input.giftId, quantity: input.quantity, ip: getClientIp(request) })
      : input.action === "release"
        ? await releaseBirthdayPoolItem({ actorId: admin.id, poolItemId: input.poolItemId, quantity: input.quantity, ip: getClientIp(request) })
        : input.action === "revoke_prize"
          ? await revokeBirthdayPrize({ actorId: admin.id, prizeId: input.prizeId, reason: input.reason, ip: getClientIp(request) })
          : await extendBirthdayWindow({ actorId: admin.id, target: input.action === "extend_draw" ? "DRAW" : "CLAIM", id: input.action === "extend_draw" ? input.benefitId : input.prizeId, days: input.days, reason: input.reason, ip: getClientIp(request) });
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "奖池参数不正确" : error instanceof Error ? error.message : "奖池更新失败" }, { status: 400 });
  }
}

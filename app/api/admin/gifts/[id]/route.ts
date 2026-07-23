import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, getClientIp } from "@/lib/security";

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(["PHYSICAL", "CASH"]).optional(),
  pointsCost: z.number().int().positive().max(10_000_000).optional(),
  stock: z.number().int().min(0).max(1_000_000).optional(),
  imageUrl: z.string().url().max(2000).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const before = await db.gift.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: "礼品不存在" }, { status: 404 });
    const gift = await db.$transaction(async (tx) => {
      const updated = await tx.gift.update({ where: { id }, data: input });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "GIFT_UPDATED",
          entity: "Gift",
          entityId: id,
          beforeValue: { name: before.name, kind: before.kind, pointsCost: before.pointsCost, stock: before.stock, active: before.active },
          afterValue: input,
          ip: getClientIp(request),
        },
      });
      return updated;
    });
    return NextResponse.json({ gift });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "礼品参数不正确" : error instanceof Error ? error.message : "更新失败" }, { status: 400 });
  }
}

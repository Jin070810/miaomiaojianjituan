import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { giftImageValueSchema, giftValidationErrorMessage } from "@/lib/gifts";
import { assertSameOrigin, getClientIp } from "@/lib/security";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["PHYSICAL", "CASH"]).default("PHYSICAL"),
  pointsCost: z.number().int().positive().max(10_000_000),
  stock: z.number().int().min(0).max(1_000_000),
  imageUrl: giftImageValueSchema,
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().default(true),
  pinned: z.boolean().default(false),
});

export async function GET() {
  try {
    await requireAdmin();
    const [gifts, sales] = await Promise.all([
      db.gift.findMany({
        where: { deletedAt: null },
        orderBy: [{ pinned: "desc" }, { displayOrder: "asc" }, { createdAt: "desc" }, { id: "asc" }],
      }),
      db.redemptionOrder.groupBy({
        by: ["giftId"],
        where: { status: { notIn: ["REJECTED", "REFUNDED"] } },
        _sum: { quantity: true },
      }),
    ]);
    const salesByGiftId = new Map(sales.map((row) => [row.giftId, row._sum.quantity ?? 0]));
    return NextResponse.json({ gifts: gifts.map((gift) => ({ ...gift, salesCount: salesByGiftId.get(gift.id) ?? 0 })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const input = schema.parse(await request.json());
    const { imageUrl: auditImageUrl, ...auditInput } = input;
    const gift = await db.$transaction(async (tx) => {
      const last = await tx.gift.aggregate({ where: { deletedAt: null }, _max: { displayOrder: true } });
      const created = await tx.gift.create({ data: { ...input, displayOrder: (last._max.displayOrder ?? -1) + 1 } });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "GIFT_CREATED",
          entity: "Gift",
          entityId: created.id,
          afterValue: {
            ...auditInput,
            imageConfigured: Boolean(auditImageUrl),
            displayOrder: created.displayOrder,
          },
          ip: getClientIp(request),
        },
      });
      return created;
    });
    return NextResponse.json({ gift }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? giftValidationErrorMessage(error) : error instanceof Error ? error.message : "创建失败" }, { status: 400 });
  }
}

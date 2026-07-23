import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["PHYSICAL", "CASH"]).default("PHYSICAL"),
  pointsCost: z.number().int().positive().max(10_000_000),
  stock: z.number().int().min(0).max(1_000_000),
  imageUrl: z.string().url().max(2000).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().default(true),
});

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ gifts: await db.gift.findMany({ orderBy: { createdAt: "desc" } }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const input = schema.parse(await request.json());
    const gift = await db.gift.create({ data: input });
    await db.auditLog.create({
      data: { actorId: admin.id, action: "GIFT_CREATED", entity: "Gift", entityId: gift.id, afterValue: input },
    });
    return NextResponse.json({ gift }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "礼品参数不正确" : error instanceof Error ? error.message : "创建失败" }, { status: 400 });
  }
}

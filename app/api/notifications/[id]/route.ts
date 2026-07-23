import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security";

const schema = z.object({ read: z.literal(true) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    schema.parse(await request.json());
    const { id } = await context.params;
    const notification = await db.notification.findFirst({ where: { id, userId: user.id } });
    if (!notification) return NextResponse.json({ error: "通知不存在" }, { status: 404 });
    if (notification.readAt) return NextResponse.json({ notification });
    const updated = await db.notification.update({ where: { id }, data: { readAt: new Date() } });
    return NextResponse.json({ notification: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "通知操作参数不正确" : error instanceof Error ? error.message : "通知操作失败" }, { status: 400 });
  }
}

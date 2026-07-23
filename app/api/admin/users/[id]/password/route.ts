import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, getClientIp, hashPassword } from "@/lib/security";

const schema = z.object({ password: z.string().min(8).max(128) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const target = await db.user.findUnique({ where: { id }, select: { id: true, kuaishouId: true } });
    if (!target) return NextResponse.json({ error: "成员不存在" }, { status: 404 });
    const passwordHash = await hashPassword(input.password);
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: id } });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "ADMIN_PASSWORD_RESET",
          entity: "User",
          entityId: id,
          afterValue: { kuaishouId: target.kuaishouId, sessionsRevoked: true },
          ip: getClientIp(request),
        },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "临时密码至少 8 位" : error instanceof Error ? error.message : "重置失败" }, { status: 400 });
  }
}

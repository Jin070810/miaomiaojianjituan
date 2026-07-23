import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin, getClientIp, hashPassword, rateLimitResponse, verifyPassword } from "@/lib/security";

const schema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await enforceRateLimit(`password-change:${user.id}`, 5, 3600);
    const input = schema.parse(await request.json());
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      return NextResponse.json({ error: "当前密码不正确" }, { status: 400 });
    }
    if (input.currentPassword === input.newPassword) {
      return NextResponse.json({ error: "新密码不能与当前密码相同" }, { status: 400 });
    }
    const passwordHash = await hashPassword(input.newPassword);
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "PASSWORD_CHANGED",
          entity: "User",
          entityId: user.id,
          afterValue: { changed: true },
          ip: getClientIp(request),
        },
      });
    });
    await createSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof z.ZodError ? "密码格式不正确（新密码至少 8 位）" : error instanceof Error ? error.message : "密码修改失败" }, { status: 400 });
  }
}

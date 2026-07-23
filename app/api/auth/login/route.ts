import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertSameOrigin, getClientIp, rateLimitResponse, verifyPassword } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSession } from "@/lib/auth";

const schema = z.object({
  kuaishouId: z.string().trim().min(2).max(80),
  password: z.string().min(6).max(128),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = schema.parse(await request.json());
    await enforceRateLimit(`login:${getClientIp(request)}:${input.kuaishouId.toLowerCase()}`, 8, 900);
    const user = await db.user.findFirst({ where: { kuaishouId: { equals: input.kuaishouId, mode: "insensitive" } } });
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
      return NextResponse.json({ error: "快手ID或密码不正确" }, { status: 401 });
    }
    if (!user.active) {
      return NextResponse.json({ error: "账号已停用，请联系管理员" }, { status: 403 });
    }
    await createSession(user.id);
    return NextResponse.json({
      user: { id: user.id, kuaishouId: user.kuaishouId, nickname: user.nickname, role: user.role },
    });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    console.error("[auth/login]", error);
    return NextResponse.json({ error: error instanceof z.ZodError ? "登录信息格式不正确" : "登录失败" }, { status: 400 });
  }
}

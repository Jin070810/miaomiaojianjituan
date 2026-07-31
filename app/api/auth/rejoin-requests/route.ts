import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertSameOrigin, getClientIp, rateLimitResponse, requestId, verifyPassword } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requestRejoin } from "@/lib/member-clearance";

const schema = z.object({ kuaishouId: z.string().trim().min(2).max(80), password: z.string().min(6).max(128) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = schema.parse(await request.json());
    const ip = getClientIp(request);
    await enforceRateLimit(`rejoin:${ip}:${input.kuaishouId.toLowerCase()}`, 5, 900);
    const user = await db.user.findFirst({ where: { kuaishouId: { equals: input.kuaishouId, mode: "insensitive" } } });
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) return NextResponse.json({ error: "快手ID或密码不正确" }, { status: 401 });
    const rejoin = await requestRejoin({ userId: user.id, ip, requestId: requestId() });
    return NextResponse.json({ request: { id: rejoin.id, status: rejoin.status, requestedAt: rejoin.requestedAt } }, { status: 201 });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof z.ZodError ? "申请参数不正确" : error instanceof Error ? error.message : "重新加入申请失败" }, { status: 400 });
  }
}

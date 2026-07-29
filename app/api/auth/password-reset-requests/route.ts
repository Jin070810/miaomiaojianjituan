import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { createPasswordResetRequest } from "@/lib/password-reset-requests";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin, getClientIp, hashPassword, rateLimitResponse, requestId } from "@/lib/security";

const schema = z.object({
  kuaishouId: z.string().trim().min(2).max(80),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = schema.parse(await request.json());
    const ip = getClientIp(request);
    await enforceRateLimit(`password-reset-request:ip:${ip}`, 5, 24 * 60 * 60);
    await enforceRateLimit(`password-reset-request:id:${input.kuaishouId.toLowerCase()}`, 3, 24 * 60 * 60);
    await createPasswordResetRequest({
      kuaishouId: input.kuaishouId,
      proposedPasswordHash: await hashPassword(input.password),
      ip,
      requestId: requestId(),
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ ok: true }, { status: 201 });
    }
    return NextResponse.json({ error: error instanceof z.ZodError ? "快手 ID 或新密码格式不正确" : "申请提交失败，请稍后重试" }, { status: 400 });
  }
}

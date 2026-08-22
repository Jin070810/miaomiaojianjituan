import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertSameOrigin, getClientIp, rateLimitResponse, requestId } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getRegistrationInviteStatus, submitRegistrationApplication } from "@/lib/registration";

const schema = z.object({
  kuaishouId: z.string().trim().min(2).max(80),
  nickname: z.string().trim().min(1).max(80),
  password: z.string().min(8).max(128),
  guildStatus: z.string().trim().max(30).optional(),
  boundPhone: z.string().trim().regex(/^1\d{10}$/).optional(),
});

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    await enforceRateLimit(`registration-link-status:${getClientIp(request)}`, 60, 3600);
    const { token } = await context.params;
    const status = await getRegistrationInviteStatus(token);
    return NextResponse.json(status, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ available: false, expiresAt: null }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    assertSameOrigin(request);
    const { token } = await context.params;
    await enforceRateLimit(`registration-application:${getClientIp(request)}`, 5, 3600);
    await enforceRateLimit(`registration-link:${token}`, 30, 3600);
    const input = schema.parse(await request.json());
    if (input.guildStatus === "未绑定" && !input.boundPhone) throw new Error("未绑定公会时需要填写绑定手机号");
    const result = await submitRegistrationApplication({ ...input, token, ip: getClientIp(request), requestId: requestId() });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    const status = error instanceof z.ZodError ? 400 : error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? 409 : error instanceof Error && error.message.includes("已有待审核") ? 409 : error instanceof Error && error.message.includes("已注册") ? 409 : 400;
    return NextResponse.json({ error: error instanceof z.ZodError ? "申请信息格式不正确" : error instanceof Error ? error.message : "申请失败" }, { status });
  }
}

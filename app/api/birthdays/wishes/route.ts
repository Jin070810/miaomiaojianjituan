import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { sendBirthdayWish } from "@/lib/birthdays";
import { assertSameOrigin, getClientIp, rateLimitResponse } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";

const schema = z.object({ recipientId: z.string().min(1), benefitYear: z.number().int().min(2000).max(2200), presetCode: z.string().min(1).max(40) });

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await enforceRateLimit(`birthday-wish:${user.id}`, 30, 60);
    const input = schema.parse(await request.json());
    const wish = await sendBirthdayWish({ ...input, senderId: user.id, ip: getClientIp(request) });
    return NextResponse.json({ wish });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof z.ZodError ? "祝福参数不正确" : error instanceof Error ? error.message : "祝福发送失败" }, { status: 400 });
  }
}

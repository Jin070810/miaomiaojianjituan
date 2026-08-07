import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { drawBirthdayPrize } from "@/lib/birthdays";
import { assertSameOrigin, getClientIp, rateLimitResponse, requireIdempotency } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await enforceRateLimit(`birthday-draw:${user.id}`, 5, 60);
    const prize = await drawBirthdayPrize({ userId: user.id, idempotencyKey: requireIdempotency(request), ip: getClientIp(request) });
    return NextResponse.json({ prize });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof Error ? error.message : "生日抽奖失败" }, { status: 400 });
  }
}

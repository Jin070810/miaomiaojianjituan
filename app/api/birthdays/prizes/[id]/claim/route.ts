import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { claimBirthdayGift } from "@/lib/birthdays";
import { assertSameOrigin, getClientIp, rateLimitResponse, requireIdempotency } from "@/lib/security";

const schema = z.object({
  recipientName: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(300).optional(),
  membershipAnswers: z.record(z.string().max(500)).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const order = await claimBirthdayGift({ ...input, userId: user.id, prizeId: id, idempotencyKey: requireIdempotency(request), ip: getClientIp(request) });
    return NextResponse.json({ order });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof z.ZodError ? "领奖资料格式不正确" : error instanceof Error ? error.message : "生日礼物领奖失败" }, { status: 400 });
  }
}

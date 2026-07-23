import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { claimRankingAward } from "@/lib/rankings";
import { assertSameOrigin, getClientIp, rateLimitResponse } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  recipientName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().regex(/^1\d{10}$/).optional(),
  address: z.string().trim().min(5).max(300).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await enforceRateLimit(`ranking-award:${user.id}`, 10, 600);
    const input = schema.parse(await request.json());
    const { id } = await context.params;
    const award = await claimRankingAward({ ...input, awardId: id, userId: user.id, ip: getClientIp(request) });
    const { recipientPhoneEnc, recipientAddressEnc, cashQrCodeUrl, ...safe } = award;
    return NextResponse.json({
      award: {
        ...safe,
        hasRecipientPhone: Boolean(recipientPhoneEnc),
        hasRecipientAddress: Boolean(recipientAddressEnc),
        hasCashQrCode: Boolean(cashQrCodeUrl),
      },
    });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof z.ZodError ? "领奖信息格式不正确" : error instanceof Error ? error.message : "领奖失败" }, { status: 400 });
  }
}

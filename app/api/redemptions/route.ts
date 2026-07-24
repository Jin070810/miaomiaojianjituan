import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { redeemGift } from "@/lib/points";
import { assertSameOrigin, getClientIp, isSafeCashQrCodeUrl, MAX_CASH_QR_CODE_LENGTH, rateLimitResponse, requireIdempotency } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { parsePagination, paginationResult } from "@/lib/pagination";
import { operationSwitchDefinitions, operationSwitchEnabled } from "@/lib/operation-switches";

const schema = z.object({
  giftId: z.string().min(1),
  quantity: z.number().int().min(1).max(20),
  shippingInfo: z.string().trim().max(500).optional(),
  note: z.string().trim().max(200).optional(),
  recipient: z.object({
    recipientName: z.string().trim().min(1).max(80).optional(),
    phone: z.string().trim().regex(/^1\d{10}$/).optional(),
    address: z.string().trim().min(5).max(300).optional(),
    cashQrCodeUrl: z.string().trim().max(MAX_CASH_QR_CODE_LENGTH).refine(isSafeCashQrCodeUrl).optional(),
  }).optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (!(await operationSwitchEnabled("REDEMPTIONS"))) {
      return NextResponse.json({ error: operationSwitchDefinitions.REDEMPTIONS.disabledMessage }, { status: 503 });
    }
    await enforceRateLimit(`redemption:${user.id}`, 10, 60);
    const input = schema.parse(await request.json());
    const order = await redeemGift({ ...input, userId: user.id, idempotencyKey: requireIdempotency(request), ip: getClientIp(request) });
    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof Error ? error.message : "兑换失败" }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { page, take, skip } = parsePagination(new URL(request.url), 50, 100);
  const where = { userId: user.id };
  const [orders, total] = await Promise.all([
    db.redemptionOrder.findMany({ where, include: { gift: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take }),
    db.redemptionOrder.count({ where }),
  ]);
  return NextResponse.json({
    orders: orders.map(({ recipientPhoneEnc, recipientAddressEnc, cashQrCodeUrl, ...order }) => ({
      ...order,
      fulfilledAt: order.fulfilledAt ?? (order.status === "FULFILLED" ? order.reviewedAt : null),
      hasRecipientPhone: Boolean(recipientPhoneEnc),
      hasRecipientAddress: Boolean(recipientAddressEnc),
      hasCashQrCode: Boolean(cashQrCodeUrl),
    })),
    pagination: paginationResult(page, take, total),
  });
}

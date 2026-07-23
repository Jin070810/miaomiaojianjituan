import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { updateRedemptionOrder } from "@/lib/points";
import { db } from "@/lib/db";
import { assertSameOrigin, decryptSensitive, getClientIp } from "@/lib/security";

const schema = z.object({
  action: z.enum(["approve", "fulfill", "reject", "refund"]),
  reason: z.string().trim().max(500).optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const order = await db.redemptionOrder.findUnique({
      where: { id },
      select: {
        id: true,
        recipientName: true,
        recipientPhoneEnc: true,
        recipientAddressEnc: true,
        cashQrCodeUrl: true,
        gift: { select: { kind: true } },
      },
    });
    if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
    return NextResponse.json({
      details: {
        recipientName: order.recipientName,
        recipientPhone: order.recipientPhoneEnc ? decryptSensitive(order.recipientPhoneEnc) : null,
        recipientAddress: order.recipientAddressEnc ? decryptSensitive(order.recipientAddressEnc) : null,
        cashQrCodeUrl: order.cashQrCodeUrl,
        kind: order.gift.kind,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法读取订单资料" }, { status: 403 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    if (["reject", "refund"].includes(input.action) && !input.reason) {
      return NextResponse.json({ error: "驳回或退款必须填写原因" }, { status: 400 });
    }
    const order = await updateRedemptionOrder({ orderId: id, ...input, actorId: admin.id, ip: getClientIp(request) });
    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "订单操作失败" }, { status: 400 });
  }
}

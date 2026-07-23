import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await requireAdmin();
    const orders = await db.redemptionOrder.findMany({
      include: { gift: true, user: { select: { kuaishouId: true, nickname: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return NextResponse.json({
      orders: orders.map(({ recipientPhoneEnc, recipientAddressEnc, cashQrCodeUrl, ...order }) => ({
        ...order,
        hasRecipientPhone: Boolean(recipientPhoneEnc),
        hasRecipientAddress: Boolean(recipientAddressEnc),
        hasCashQrCode: Boolean(cashQrCodeUrl),
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

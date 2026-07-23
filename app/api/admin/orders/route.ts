import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptSensitive } from "@/lib/security";

export async function GET() {
  try {
    await requireAdmin();
    const orders = await db.redemptionOrder.findMany({
      include: { gift: true, user: { select: { kuaishouId: true, nickname: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    return NextResponse.json({
      orders: orders.map(({ recipientPhoneEnc, recipientAddressEnc, ...order }) => ({
        ...order,
        recipientPhone: recipientPhoneEnc ? decryptSensitive(recipientPhoneEnc) : null,
        recipientAddress: recipientAddressEnc ? decryptSensitive(recipientAddressEnc) : null,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

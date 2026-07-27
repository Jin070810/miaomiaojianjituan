import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const [gifts, sales] = await Promise.all([
    db.gift.findMany({
      where: { active: true, deletedAt: null },
      orderBy: [{ pinned: "desc" }, { displayOrder: "asc" }, { createdAt: "desc" }, { id: "asc" }],
    }),
    db.redemptionOrder.groupBy({
      by: ["giftId"],
      where: { status: { notIn: ["REJECTED", "REFUNDED"] } },
      _sum: { quantity: true },
    }),
  ]);
  const salesByGiftId = new Map(sales.map((row) => [row.giftId, row._sum.quantity ?? 0]));
  return NextResponse.json({ gifts: gifts.map((gift) => ({ ...gift, salesCount: salesByGiftId.get(gift.id) ?? 0 })) });
}

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const gifts = await db.gift.findMany({
    where: { active: true, deletedAt: null },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }, { id: "asc" }],
  });
  return NextResponse.json({ gifts });
}

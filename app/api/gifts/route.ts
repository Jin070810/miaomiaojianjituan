import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const gifts = await db.gift.findMany({ where: { active: true }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ gifts });
}

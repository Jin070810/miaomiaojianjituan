import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await requireAdmin();
    const appeals = await db.videoAppeal.findMany({
      where: { status: "PENDING" },
      include: {
        video: true,
        user: { select: { id: true, kuaishouId: true, nickname: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return NextResponse.json({ appeals });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

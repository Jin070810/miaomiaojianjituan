import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await requireAdmin();
    const [pending, approved] = await Promise.all([
      db.videoSubmission.findMany({
        where: { status: { in: ["PENDING_REVIEW", "FAILED"] } },
        include: { user: { select: { kuaishouId: true, nickname: true } } },
        orderBy: { submittedAt: "asc" },
        take: 200,
      }),
      db.videoSubmission.findMany({
        where: { status: "APPROVED" },
        include: { user: { select: { kuaishouId: true, nickname: true } } },
        orderBy: { submittedAt: "desc" },
        take: 100,
      }),
    ]);
    const videos = [...pending, ...approved];
    return NextResponse.json({ videos });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

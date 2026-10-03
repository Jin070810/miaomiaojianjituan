import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "无权访问" }, { status: 403 }); }
  const query = new URL(request.url).searchParams;
  const status = query.get("status") ?? "PENDING";
  const page = Number(query.get("page") ?? 1);
  if (!["PENDING", "RESOLVED"].includes(status) || !Number.isInteger(page) || page < 1 || page > 100_000) return NextResponse.json({ error: "筛选参数不正确" }, { status: 400 });
  const take = 20;
  try {
  const [tasks, total, pending, unpaid, paid] = await Promise.all([
    db.rankingAwardAdjustment.findMany({ where: { status }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * take, take,
      include: { award: { select: { id: true, status: true, rank: true, value: true, rewardTitle: true, user: { select: { nickname: true, kuaishouId: true } }, period: { select: { type: true, periodStart: true, periodEnd: true } } } } } }),
    db.rankingAwardAdjustment.count({ where: { status } }),
    db.rankingAwardAdjustment.count({ where: { status: "PENDING" } }),
    db.rankingAwardAdjustment.count({ where: { status: "PENDING", kind: "FREEZE_UNPAID" } }),
    db.rankingAwardAdjustment.count({ where: { status: "PENDING", kind: "REVIEW_PAID" } }),
  ]);
  return NextResponse.json({ tasks, pagination: { page, take, total, pages: Math.ceil(total / take) }, counts: { pending, unpaid, paid } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "榜单调整待办暂时无法读取，请稍后刷新重试" }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}

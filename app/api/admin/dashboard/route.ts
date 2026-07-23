import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await requireAdmin();
    const [users, pendingAppeals, gifts, pendingOrders, recentAudit, accounts] = await Promise.all([
      db.user.count(),
      db.videoAppeal.count({ where: { status: "PENDING" } }),
      db.gift.count({ where: { active: true } }),
      db.redemptionOrder.count({ where: { status: "PENDING" } }),
      db.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { actor: { select: { kuaishouId: true, nickname: true } } },
      }),
      db.pointAccount.aggregate({ _sum: { balance: true } }),
    ]);
    return NextResponse.json({
      metrics: {
        users,
        pendingVideos: pendingAppeals,
        pendingAppeals,
        activeGifts: gifts,
        pendingOrders,
        totalBalance: accounts._sum.balance ?? 0,
      },
      audit: recentAudit,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

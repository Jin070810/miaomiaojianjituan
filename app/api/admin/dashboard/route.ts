import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { presentAuditLog } from "@/lib/audit";

function shanghaiDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shanghaiDayLabel(value: Date) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  return `${parts.find((part) => part.type === "month")?.value ?? ""}/${parts.find((part) => part.type === "day")?.value ?? ""}`;
}

export async function GET() {
  try {
    await requireAdmin();
    const trendStart = new Date(Date.now() - 6 * 86_400_000);
    const [users, pendingAppeals, gifts, pendingOrders, recentAudit, accounts] = await Promise.all([
      db.user.count(),
      db.videoAppeal.count({ where: { status: "PENDING" } }),
      db.gift.count({ where: { active: true } }),
      db.redemptionOrder.count({ where: { status: { in: ["PENDING", "APPROVED"] } } }),
      db.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { actor: { select: { kuaishouId: true, nickname: true, role: true } } },
      }),
      db.pointAccount.aggregate({ _sum: { balance: true } }),
    ]);
    const trendLedger = await db.pointLedger.findMany({
      where: {
        createdAt: { gte: trendStart },
        type: { in: ["VIDEO_REWARD", "ADMIN_ADJUSTMENT"] },
      },
      select: { amount: true, type: true, createdAt: true },
    });
    const pointsTrend = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.now() - (6 - index) * 86_400_000);
      const key = shanghaiDateKey(date);
      const rows = trendLedger.filter((row) => shanghaiDateKey(row.createdAt) === key);
      return {
        label: shanghaiDayLabel(date),
        videoReward: rows.filter((row) => row.type === "VIDEO_REWARD" && row.amount > 0).reduce((sum, row) => sum + row.amount, 0),
        adminAdjustment: rows.filter((row) => row.type === "ADMIN_ADJUSTMENT" && row.amount > 0).reduce((sum, row) => sum + row.amount, 0),
      };
    });
    return NextResponse.json({
      metrics: {
        users,
        pendingVideos: pendingAppeals,
        pendingAppeals,
        activeGifts: gifts,
        pendingOrders,
        totalBalance: accounts._sum.balance ?? 0,
      },
      audit: recentAudit.map((row) => presentAuditLog(row)),
      pointsTrend,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

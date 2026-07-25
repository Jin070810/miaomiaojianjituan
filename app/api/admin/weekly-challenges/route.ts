import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { paginationResult, parsePagination } from "@/lib/pagination";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { page, take, skip } = parsePagination(new URL(request.url), 10, 50);
    const [periods, total] = await Promise.all([
      db.weeklyChallengePeriod.findMany({
        orderBy: { periodStart: "desc" },
        skip,
        take,
        include: {
          raceWinner: {
            include: { user: { select: { nickname: true, kuaishouId: true } } },
          },
          _count: { select: { assignments: true, attempts: true } },
        },
      }),
      db.weeklyChallengePeriod.count(),
    ]);
    const rewardRows = periods.length
      ? await db.weeklyChallengeAssignment.groupBy({
          by: ["periodId", "status"],
          where: { periodId: { in: periods.map((period) => period.id) } },
          _count: { id: true },
          _sum: { rewardPoints: true },
        })
      : [];
    return NextResponse.json({
      periods: periods.map((period) => ({
        ...period,
        rewardSummary: rewardRows.filter((row) => row.periodId === period.id),
      })),
      pagination: paginationResult(page, take, total),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

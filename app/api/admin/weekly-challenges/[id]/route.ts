import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const period = await db.weeklyChallengePeriod.findUnique({
      where: { id },
      include: {
        assignments: {
          include: { user: { select: { nickname: true, kuaishouId: true, active: true } } },
          orderBy: [{ status: "asc" }, { difficultyScore: "desc" }],
        },
        attempts: {
          orderBy: [{ batchNumber: "asc" }, { attemptNumber: "asc" }],
          select: {
            id: true,
            batchNumber: true,
            attemptNumber: true,
            status: true,
            source: true,
            generationRunId: true,
            model: true,
            promptVersion: true,
            requestId: true,
            memberCount: true,
            latencyMs: true,
            inputTokens: true,
            outputTokens: true,
            error: true,
            createdAt: true,
          },
        },
        raceWinner: {
          include: { user: { select: { nickname: true, kuaishouId: true } } },
        },
      },
    });
    if (!period) return NextResponse.json({ error: "周挑战周期不存在" }, { status: 404 });
    const progressRows = await db.videoSubmission.groupBy({
      by: ["userId"],
      where: {
        userId: { in: period.assignments.map((assignment) => assignment.userId) },
        status: "APPROVED",
        submittedAt: { gte: period.periodStart, lt: period.periodEnd },
      },
      _count: { id: true },
      _sum: { likes: true },
    });
    const progress = new Map(progressRows.map((row) => [row.userId, {
      videoCount: row._count.id,
      likes: row._sum.likes ?? 0,
    }]));
    return NextResponse.json({
      period: {
        ...period,
        assignments: period.assignments.map((assignment) => ({
          ...assignment,
          progress: progress.get(assignment.userId) ?? { videoCount: 0, likes: 0 },
        })),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

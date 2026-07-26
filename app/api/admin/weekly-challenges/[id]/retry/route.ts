import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueWeeklyChallengeGeneration } from "@/lib/weekly-challenge-jobs";
import { assertSameOrigin, getClientIp, requestId } from "@/lib/security";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const period = await db.weeklyChallengePeriod.findUnique({ where: { id } });
    if (!period) return NextResponse.json({ error: "周挑战周期不存在" }, { status: 404 });
    if (period.status !== "FAILED") return NextResponse.json({ error: "只有生成失败的周期可以重试" }, { status: 409 });
    if (new Date() >= period.periodStart) return NextResponse.json({ error: "周期已经开始，本周不再补发任务" }, { status: 409 });
    const job = await enqueueWeeklyChallengeGeneration(period.periodStart, true, true);
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: "WEEKLY_CHALLENGE_RETRY_REQUESTED",
        entity: "WeeklyChallengePeriod",
        entityId: period.id,
        afterValue: { jobId: job.id },
        ip: getClientIp(request),
        requestId: requestId(),
      },
    });
    return NextResponse.json({ queued: true, jobId: job.id }, { status: 202 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "周挑战重试失败",
    }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin, getClientIp, requestId } from "@/lib/security";
import { enqueueWeeklyChallengeGeneration } from "@/lib/weekly-challenge-jobs";
import { prepareWeeklyChallengePeriodRegeneration } from "@/lib/weekly-challenge-upgrade";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const result = await prepareWeeklyChallengePeriodRegeneration({
      periodId: id,
      actorId: admin.id,
      ip: getClientIp(request),
      requestId: requestId(),
    });
    const queued = await enqueueWeeklyChallengeGeneration(result.periodStart, true, true);
    return NextResponse.json({
      ...result,
      queued: true,
      jobId: queued.job.id,
      queueState: queued.state,
      alreadyRunning: queued.reused,
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "周挑战重新生成提交失败",
    }, { status: 400 });
  }
}

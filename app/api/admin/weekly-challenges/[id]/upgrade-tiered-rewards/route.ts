import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin, getClientIp, requestId } from "@/lib/security";
import { upgradeWeeklyChallengePeriodToTieredRewards } from "@/lib/weekly-challenge-upgrade";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const result = await upgradeWeeklyChallengePeriodToTieredRewards({
      periodId: id,
      actorId: admin.id,
      ip: getClientIp(request),
      requestId: requestId(),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "周挑战阶梯奖励升级失败",
    }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { claimWeeklyChallenge } from "@/lib/weekly-challenges";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  assertSameOrigin,
  getClientIp,
  rateLimitResponse,
  requireIdempotency,
} from "@/lib/security";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(`weekly-challenge-claim:${user.id}`, 10, 60);
    const idempotencyKey = requireIdempotency(request);
    const { id } = await context.params;
    const result = await claimWeeklyChallenge({
      assignmentId: id,
      userId: user.id,
      idempotencyKey,
      ip: getClientIp(request),
    });
    return NextResponse.json(result);
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({
      error: error instanceof Error ? error.message : "周挑战奖励领取失败",
    }, { status: 400 });
  }
}

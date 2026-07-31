import { NextResponse } from "next/server";
import { z } from "zod";
import { requireVideoReviewOperator } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveVideoSecondaryReview } from "@/lib/points";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin, getClientIp, rateLimitResponse } from "@/lib/security";

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const operator = await requireVideoReviewOperator();
    await enforceRateLimit(`video-secondary-review:${operator.id}`, 120, 60);
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    if (input.action === "reject" && !input.reason) {
      return NextResponse.json({ error: "二次审核驳回必须填写原因" }, { status: 400 });
    }
    const review = await resolveVideoSecondaryReview({
      reviewId: id,
      action: input.action,
      actorId: operator.id,
      actorRole: operator.role,
      reason: input.reason,
      ip: getClientIp(request),
    });
    const refreshed = await db.videoSecondaryReview.findUnique({
      where: { id: review.id },
      include: {
        reviewer: { select: { id: true, kuaishouId: true, nickname: true, role: true } },
        video: { include: { user: { select: { id: true, kuaishouId: true, nickname: true } } } },
      },
    });
    return NextResponse.json({ review: refreshed ?? review });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    const message = error instanceof z.ZodError ? "二次审核参数不正确" : error instanceof Error ? error.message : "操作失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

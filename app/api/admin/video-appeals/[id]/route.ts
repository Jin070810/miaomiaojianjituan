import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { resolveVideoAppeal } from "@/lib/points";
import { assertSameOrigin, getClientIp } from "@/lib/security";

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  // The service enforces this video's captured cap; the API limit matches allowed rule settings.
  points: z.number().int().min(0).max(10_000_000).optional(),
  expectedRuleRevision: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  expectedCalculatedPoints: z.number().int().min(0).max(10_000_000).optional(),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    if (input.action === "reject" && !input.reason) {
      return NextResponse.json({ error: "驳回申诉必须填写原因" }, { status: 400 });
    }
    const appeal = await resolveVideoAppeal({
      appealId: id,
      action: input.action,
      points: input.points,
      expectedRuleRevision: input.expectedRuleRevision,
      expectedCalculatedPoints: input.expectedCalculatedPoints,
      reason: input.reason,
      actorId: admin.id,
      ip: getClientIp(request),
    });
    return NextResponse.json({ appeal });
  } catch (error) {
    const message = error instanceof z.ZodError ? "申诉处理参数不正确" : error instanceof Error ? error.message : "申诉处理失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

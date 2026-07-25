import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { adminAdjustPointsBatch, BulkPointAdjustmentError } from "@/lib/points";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin, getClientIp, rateLimitResponse, requireIdempotency } from "@/lib/security";

const schema = z.object({
  selectionMode: z.enum(["EXPLICIT", "ALL_ACTIVE_MEMBERS"]).default("EXPLICIT"),
  userIds: z.array(z.string().min(1)).optional(),
  amount: z.number().int().min(-1_000_000).max(1_000_000).refine((amount) => amount !== 0),
  reason: z.string().trim().min(2).max(500),
}).superRefine((input, context) => {
  if (input.selectionMode === "EXPLICIT" && !input.userIds?.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["userIds"], message: "至少选择一名成员" });
  }
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    await enforceRateLimit(`admin-points-bulk:${admin.id}`, 30, 60);
    const input = schema.parse(await request.json());
    const result = await adminAdjustPointsBatch({
      ...input,
      actorId: admin.id,
      idempotencyKey: requireIdempotency(request),
      ip: getClientIp(request),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    const message = error instanceof z.ZodError ? "批量积分信息格式不正确" : error instanceof Error ? error.message : "批量积分调整失败";
    const details = error instanceof BulkPointAdjustmentError && error.blockers.length ? error.blockers : undefined;
    return NextResponse.json({ error: message, blockers: details }, { status: details ? 409 : 400 });
  }
}

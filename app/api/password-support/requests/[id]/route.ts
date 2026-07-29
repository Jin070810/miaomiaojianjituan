import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePasswordResetApprover } from "@/lib/auth";
import { reviewPasswordResetRequest } from "@/lib/password-reset-requests";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin, getClientIp, rateLimitResponse, requestId } from "@/lib/security";

const schema = z.object({ action: z.enum(["APPROVE", "REJECT"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const approver = await requirePasswordResetApprover();
    await enforceRateLimit(`password-reset-review:${approver.id}`, 60, 3600);
    const input = schema.parse(await request.json());
    const { id } = await context.params;
    const result = await reviewPasswordResetRequest({
      requestId: id,
      action: input.action,
      approver: { id: approver.id, role: approver.role },
      ip: getClientIp(request),
      auditRequestId: requestId(),
    });
    return NextResponse.json(result);
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof z.ZodError ? "审批参数不正确" : error instanceof Error ? error.message : "审批失败" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePasswordResetApprover } from "@/lib/auth";
import { assertSameOrigin, getClientIp, requestId } from "@/lib/security";
import { reviewRejoin } from "@/lib/member-clearance";

const schema = z.object({ action: z.enum(["APPROVE", "REJECT"]), reason: z.string().trim().max(300).optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const reviewer = await requirePasswordResetApprover();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const result = await reviewRejoin({ requestId: id, reviewerId: reviewer.id, approved: input.action === "APPROVE", reason: input.reason, ip: getClientIp(request), requestTraceId: requestId() });
    return NextResponse.json({ request: result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "审核参数不正确" : error instanceof Error ? error.message : "审核失败" }, { status: 400 });
  }
}

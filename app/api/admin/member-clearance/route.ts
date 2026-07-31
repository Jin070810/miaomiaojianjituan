import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requirePasswordResetApprover } from "@/lib/auth";
import { assertSameOrigin, getClientIp, requestId } from "@/lib/security";
import { createClearancePolicyVersion, listMemberClearanceAdmin } from "@/lib/member-clearance";

const schema = z.object({ inactivityDays: z.number().int(), warningDays: z.array(z.number().int()), cooldownDays: z.number().int() });

export async function GET() {
  try {
    await requirePasswordResetApprover();
    return NextResponse.json(await listMemberClearanceAdmin());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const input = schema.parse(await request.json());
    const policy = await createClearancePolicyVersion({ ...input, actorId: admin.id, ip: getClientIp(request), requestId: requestId() });
    return NextResponse.json({ policy });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "规则参数不正确" : error instanceof Error ? error.message : "规则保存失败" }, { status: 400 });
  }
}

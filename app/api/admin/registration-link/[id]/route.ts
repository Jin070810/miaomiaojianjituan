import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin, getClientIp, requestId } from "@/lib/security";
import { revokeRegistrationInviteLink } from "@/lib/registration";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const link = await revokeRegistrationInviteLink({ id, actorId: admin.id, ip: getClientIp(request), requestId: requestId() });
    return NextResponse.json({ link });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "链接停用失败" }, { status: 400 });
  }
}

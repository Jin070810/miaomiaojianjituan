import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { updateMemberBirthday } from "@/lib/birthdays";
import { assertSameOrigin, getClientIp } from "@/lib/security";

const schema = z.object({ birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(2).max(500) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const profile = await updateMemberBirthday({ userId: id, birthday: input.birthday, actorId: admin.id, adminReason: input.reason, ip: getClientIp(request) });
    return NextResponse.json({ profile: { id: profile.id, pendingBirthMonth: profile.pendingBirthMonth, pendingBirthDay: profile.pendingBirthDay, pendingEffectiveAt: profile.pendingEffectiveAt } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "生日纠错参数不正确" : error instanceof Error ? error.message : "生日纠错失败" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { reorderAdminGifts } from "@/lib/admin-gifts";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin, getClientIp } from "@/lib/security";

const schema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1).max(1000).refine((ids) => new Set(ids).size === ids.length, "礼品排序不能包含重复项"),
});

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const input = schema.parse(await request.json());
    const gifts = await reorderAdminGifts({ actorId: admin.id, orderedIds: input.orderedIds, ip: getClientIp(request) });
    return NextResponse.json({ gifts });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "礼品排序参数不正确" : error instanceof Error ? error.message : "礼品排序失败" }, { status: 400 });
  }
}

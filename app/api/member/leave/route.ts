import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, destroySession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { voluntarilyExitMember, VOLUNTARY_EXIT_REASONS } from "@/lib/member-voluntary-exit";
import { assertSameOrigin, getClientIp, rateLimitResponse, requestId } from "@/lib/security";

const schema = z.object({
  reason: z.enum(VOLUNTARY_EXIT_REASONS),
  confirmed: z.literal(true),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await enforceRateLimit(`member-leave:${user.id}`, 3, 3600);
    const input = schema.parse(await request.json());
    const result = await voluntarilyExitMember({
      userId: user.id,
      reason: input.reason,
      ip: getClientIp(request),
      requestId: requestId(),
    });
    await destroySession();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof z.ZodError ? "请选择退团原因并完成二次确认" : error instanceof Error ? error.message : "退团失败" }, { status: 400 });
  }
}

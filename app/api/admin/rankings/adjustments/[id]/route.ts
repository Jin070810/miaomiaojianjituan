import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin, getClientIp } from "@/lib/security";
import { RankingAdjustmentError, resolveRankingAdjustment } from "@/lib/ranking-adjustments";

const schema = z.object({ resolution: z.enum(["RELEASE", "CANCEL", "ADJUSTED", "NO_CHANGE"]), note: z.string().trim().min(5).max(1000) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  let admin;
  try { assertSameOrigin(request); admin = await requireAdmin(); } catch { return NextResponse.json({ error: "无权处理榜单调整" }, { status: 403 }); }
  try {
    const input = schema.parse(await request.json());
    const { id } = await context.params;
    const task = await resolveRankingAdjustment({ ...input, id, actorId: admin.id, ip: getClientIp(request) });
    return NextResponse.json({ task }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
    return NextResponse.json({ error: invalid ? "请选择处理结果，并填写 5 至 1000 字的依据" : error instanceof RankingAdjustmentError ? error.message : "榜单调整暂时失败，请稍后刷新重试" }, { status: invalid || error instanceof RankingAdjustmentError ? 400 : 500, headers: { "Cache-Control": "private, no-store" } });
  }
}

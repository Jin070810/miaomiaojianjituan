import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { revokeVideoReward } from "@/lib/points";
import { assertSameOrigin, getClientIp } from "@/lib/security";

const schema = z.object({ action: z.enum(["revoke"]), reason: z.string().trim().max(500).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const video = await db.videoSubmission.findUnique({ where: { id } });
    if (!video) return NextResponse.json({ error: "视频记录不存在" }, { status: 404 });
    if (input.action === "revoke") {
      if (!input.reason) return NextResponse.json({ error: "撤销必须填写原因" }, { status: 400 });
      return NextResponse.json({ video: await revokeVideoReward({ videoId: id, reason: input.reason, actorId: admin.id, ip: getClientIp(request) }) });
    }
    return NextResponse.json({ error: "普通视频由系统自动处理；需要人工复查请提交申诉" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "操作失败" }, { status: 400 });
  }
}

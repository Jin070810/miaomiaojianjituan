import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { revokeVideoReward } from "@/lib/points";
import { enqueueVideo, prepareVideoReprocess } from "@/lib/video-jobs";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin, getClientIp, rateLimitResponse } from "@/lib/security";

const schema = z.object({ action: z.enum(["revoke", "reprocess"]), reason: z.string().trim().max(500).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    await enforceRateLimit(`admin-video-action:${admin.id}`, 60, 60);
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const video = await db.videoSubmission.findUnique({ where: { id } });
    if (!video) return NextResponse.json({ error: "视频记录不存在" }, { status: 404 });
    if (input.action === "revoke") {
      if (!input.reason) return NextResponse.json({ error: "撤销必须填写原因" }, { status: 400 });
      return NextResponse.json({ video: await revokeVideoReward({ videoId: id, reason: input.reason, actorId: admin.id, ip: getClientIp(request) }) });
    }
    const updated = await prepareVideoReprocess({ videoId: id, actorId: admin.id, ip: getClientIp(request) });
    try {
      await enqueueVideo(id);
    } catch (error) {
      await db.$transaction(async (tx) => {
        await tx.videoSubmission.updateMany({
          where: { id, status: "PROCESSING" },
          data: { status: "FAILED", reviewReason: "处理队列暂时不可用，请稍后重试" },
        });
        await tx.auditLog.create({
          data: {
            actorId: admin.id,
            action: "VIDEO_REPROCESS_ENQUEUE_FAILED",
            entity: "VideoSubmission",
            entityId: id,
            reason: error instanceof Error ? error.message : "queue unavailable",
            ip: getClientIp(request),
          },
        });
      });
      return NextResponse.json({ error: "处理队列暂时不可用，请稍后重试" }, { status: 503 });
    }
    return NextResponse.json({ video: updated }, { status: 202 });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof Error ? error.message : "操作失败" }, { status: 400 });
  }
}

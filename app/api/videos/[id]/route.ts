import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { creditVideoReward, rejectVideo, revokeVideoReward } from "@/lib/points";
import { assertSameOrigin, getClientIp } from "@/lib/security";

const schema = z.object({ action: z.enum(["approve", "reject", "revoke", "reprocess"]), points: z.number().int().min(0).max(5000).optional(), reason: z.string().trim().max(500).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const video = await db.videoSubmission.findUnique({ where: { id } });
    if (!video) return NextResponse.json({ error: "视频记录不存在" }, { status: 404 });
    if (input.action === "reprocess") {
      if (video.status === "APPROVED") return NextResponse.json({ error: "已到账视频不能重新抓取，请使用撤销后重新提交" }, { status: 400 });
      const updated = await db.$transaction(async (tx) => {
        const next = await tx.videoSubmission.update({ where: { id }, data: { status: "PROCESSING", reviewReason: null } });
        await tx.auditLog.create({
          data: {
            actorId: admin.id,
            action: "VIDEO_REPROCESS_REQUESTED",
            entity: "VideoSubmission",
            entityId: id,
            beforeValue: { status: video.status },
            afterValue: { status: next.status },
            ip: getClientIp(request),
          },
        });
        return next;
      });
      const { enqueueVideo } = await import("@/lib/video-jobs");
      await enqueueVideo(updated.id);
      return NextResponse.json({ video: updated });
    }
    if (input.action === "reject") {
      if (!input.reason) return NextResponse.json({ error: "驳回必须填写原因" }, { status: 400 });
      return NextResponse.json({ video: await rejectVideo({ videoId: id, reason: input.reason, actorId: admin.id, ip: getClientIp(request) }) });
    }
    if (input.action === "revoke") {
      if (!input.reason) return NextResponse.json({ error: "撤销必须填写原因" }, { status: 400 });
      return NextResponse.json({ video: await revokeVideoReward({ videoId: id, reason: input.reason, actorId: admin.id, ip: getClientIp(request) }) });
    }
    const points = input.points ?? video.points;
    return NextResponse.json({ video: await creditVideoReward({ videoId: id, userId: video.userId, points, actorId: admin.id, ip: getClientIp(request) }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "操作失败" }, { status: 400 });
  }
}

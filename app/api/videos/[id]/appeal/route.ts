import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, getClientIp, rateLimitResponse, requireIdempotency } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";

const schema = z.object({ reason: z.string().trim().min(2).max(1000) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let videoId = "";
  let userId = "";
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    userId = user.id;
    await enforceRateLimit(`video-appeal:${user.id}`, 5, 60);
    const idempotencyKey = requireIdempotency(request);
    const { id } = await context.params;
    videoId = id;
    const input = schema.parse(await request.json());
    const existing = await db.videoAppeal.findUnique({ where: { idempotencyKey } });
    if (existing) return NextResponse.json({ appeal: existing });
    const appeal = await db.$transaction(async (tx) => {
      const video = await tx.videoSubmission.findUnique({ where: { id } });
      if (!video || video.userId !== user.id) throw new Error("视频记录不存在");
      if (video.status !== "REJECTED") throw new Error("只有自动驳回的视频可以申诉");
      const pending = await tx.videoAppeal.findFirst({ where: { videoId: id, status: "PENDING" } });
      if (pending) return pending;
      const created = await tx.videoAppeal.create({
        data: { videoId: id, userId: user.id, reason: input.reason, idempotencyKey },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "VIDEO_APPEAL_CREATED",
          entity: "VideoAppeal",
          entityId: created.id,
          afterValue: { videoId: id, reason: input.reason },
          ip: getClientIp(request),
          requestId: idempotencyKey,
        },
      });
      return created;
    });
    return NextResponse.json({ appeal }, { status: 201 });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && videoId && userId) {
      const pending = await db.videoAppeal.findFirst({ where: { videoId, userId, status: "PENDING" } });
      if (pending) return NextResponse.json({ appeal: pending, duplicate: true });
    }
    const message = error instanceof z.ZodError ? "申诉理由至少 2 个字" : error instanceof Error ? error.message : "申诉失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

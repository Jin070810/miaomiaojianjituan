import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeKuaishouLink } from "@/lib/kuaishou";
import { enqueueVideo } from "@/lib/video-jobs";
import { assertSameOrigin, getClientIp, rateLimitResponse, requireIdempotency } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";

const schema = z.object({ link: z.string().trim().min(8).max(2000) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await enforceRateLimit(`video-submit:${user.id}`, 10, 60);
    const idempotencyKey = requireIdempotency(request);
    const input = schema.parse(await request.json());
    const normalized = normalizeKuaishouLink(input.link);
    const existing = await db.videoSubmission.findUnique({ where: { idempotencyKey } });
    if (existing) return NextResponse.json({ video: existing });
    const sameSource = await db.videoSubmission.findFirst({
      where: {
        userId: user.id,
        requestUrl: normalized.requestUrl,
        status: { in: ["PROCESSING", "PENDING_REVIEW", "APPROVED"] },
      },
      orderBy: { submittedAt: "desc" },
    });
    if (sameSource) {
      return NextResponse.json({ video: sameSource, duplicate: true }, { status: 409 });
    }
    const video = await db.videoSubmission.create({
      data: {
        userId: user.id,
        sourceUrl: normalized.sourceUrl,
        requestUrl: normalized.requestUrl,
        sourceKind: normalized.sourceKind,
        shortCode: normalized.shortCode,
        submittedNickname: user.nickname.trim(),
        idempotencyKey,
      },
    });
    await db.auditLog.create({
      data: {
        actorId: user.id,
        action: "VIDEO_SUBMITTED",
        entity: "VideoSubmission",
        entityId: video.id,
        afterValue: { sourceKind: normalized.sourceKind, requestUrl: normalized.requestUrl },
        ip: getClientIp(request),
        requestId: idempotencyKey,
      },
    });
    await enqueueVideo(video.id);
    return NextResponse.json({ video }, { status: 201 });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const idempotencyKey = request.headers.get("idempotency-key");
      if (idempotencyKey) {
        const existing = await db.videoSubmission.findUnique({ where: { idempotencyKey } });
        if (existing) return NextResponse.json({ video: existing, duplicate: true }, { status: 200 });
      }
    }
    const message = error instanceof z.ZodError ? "请输入快手视频链接或分享文本" : error instanceof Error ? error.message : "提交失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const url = new URL(request.url);
  const take = Math.min(Number(url.searchParams.get("take") ?? 50), 100);
  const rows = await db.videoSubmission.findMany({ where: { userId: user.id }, orderBy: { submittedAt: "desc" }, take });
  return NextResponse.json({ videos: rows });
}

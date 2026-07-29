import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeKuaishouLink } from "@/lib/kuaishou";
import { enqueueVideo } from "@/lib/video-jobs";
import { assertSameOrigin, getClientIp, rateLimitResponse, requireIdempotency } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { parsePagination, paginationResult } from "@/lib/pagination";
import { operationSwitchDefinitions, operationSwitchEnabled } from "@/lib/operation-switches";
import { periodBounds } from "@/lib/rankings";

const schema = z.object({ link: z.string().trim().min(8).max(2000) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (!(await operationSwitchEnabled("VIDEO_SUBMISSIONS"))) {
      return NextResponse.json({ error: operationSwitchDefinitions.VIDEO_SUBMISSIONS.disabledMessage }, { status: 503 });
    }
    await enforceRateLimit(`video-submit:${user.id}`, 10, 60);
    const idempotencyKey = requireIdempotency(request);
    const input = schema.parse(await request.json());
    const normalized = normalizeKuaishouLink(input.link);
    const existing = await db.videoSubmission.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.status === "PROCESSING") {
        try {
          await enqueueVideo(existing.id);
        } catch (error) {
          console.error("[video-submit] enqueue retry failed", { videoId: existing.id, error });
          return NextResponse.json({ error: "视频已记录，但处理队列暂时不可用，请稍后重试" }, { status: 503 });
        }
      }
      return NextResponse.json({ video: existing, duplicate: true });
    }
    const sameSource = await db.videoSubmission.findFirst({
      where: {
        userId: user.id,
        requestUrl: normalized.requestUrl,
        status: { in: ["PROCESSING", "PENDING_REVIEW", "APPROVED"] },
      },
      orderBy: { submittedAt: "desc" },
    });
    if (sameSource) {
      if (sameSource.status === "PROCESSING") {
        try {
          await enqueueVideo(sameSource.id);
        } catch (error) {
          console.error("[video-submit] enqueue existing failed", { videoId: sameSource.id, error });
          return NextResponse.json({ error: "视频已提交，处理队列暂时不可用，请稍后重试" }, { status: 503 });
        }
      }
      return NextResponse.json({ video: sameSource, duplicate: true }, { status: 409 });
    }
    const video = await db.$transaction(async (tx) => {
      const created = await tx.videoSubmission.create({
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
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "VIDEO_SUBMITTED",
          entity: "VideoSubmission",
          entityId: created.id,
          afterValue: { sourceKind: normalized.sourceKind, requestUrl: normalized.requestUrl },
          ip: getClientIp(request),
          requestId: idempotencyKey,
        },
      });
      return created;
    });
    try {
      await enqueueVideo(video.id);
    } catch (error) {
      console.error("[video-submit] enqueue failed", { videoId: video.id, error });
      await db.auditLog.create({
        data: {
          actorId: user.id,
          action: "VIDEO_ENQUEUE_FAILED",
          entity: "VideoSubmission",
          entityId: video.id,
          reason: error instanceof Error ? error.message : "queue unavailable",
          ip: getClientIp(request),
          requestId: idempotencyKey,
        },
      }).catch((auditError) => console.error("[video-submit] enqueue audit failed", auditError));
      return NextResponse.json({ error: "视频已记录，但处理队列暂时不可用，请稍后重试" }, { status: 503 });
    }
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
  const { page, take, skip } = parsePagination(url, 50, 100);
  const where = { userId: user.id };
  const startOfMonth = periodBounds("month").start;
  const [rows, total, videoStats, monthlyVideoStats, videoStatusGroups] = await Promise.all([
    db.videoSubmission.findMany({ where, include: { appeals: { orderBy: { createdAt: "desc" }, take: 3 } }, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], skip, take }),
    db.videoSubmission.count({ where }),
    db.videoSubmission.aggregate({
      where: { userId: user.id, status: "APPROVED" },
      _count: { id: true },
      _sum: { points: true, likes: true },
    }),
    db.videoSubmission.count({ where: { userId: user.id, status: "APPROVED", submittedAt: { gte: startOfMonth } } }),
    db.videoSubmission.groupBy({ by: ["status"], where, _count: { id: true } }),
  ]);
  const videoCounts = videoStatusGroups.reduce(
    (counts, row) => {
      counts.all += row._count.id;
      if (row.status === "APPROVED") counts.approved += row._count.id;
      if (row.status === "PROCESSING") counts.processing += row._count.id;
      if (["REJECTED", "FAILED", "PENDING_REVIEW", "REVOKED"].includes(row.status)) counts.exception += row._count.id;
      return counts;
    },
    { all: 0, approved: 0, processing: 0, exception: 0 },
  );
  return NextResponse.json({
    videos: rows,
    pagination: paginationResult(page, take, total),
    summary: {
      approvedVideos: videoStats._count.id,
      monthlyApprovedVideos: monthlyVideoStats,
      videoPoints: videoStats._sum.points ?? 0,
      totalLikes: videoStats._sum.likes ?? 0,
      averageLikes: videoStats._count.id > 0 ? Math.floor((videoStats._sum.likes ?? 0) / videoStats._count.id) : 0,
      videoCounts,
    },
  });
}

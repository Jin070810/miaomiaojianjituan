import { NextResponse } from "next/server";
import { VideoSecondaryReviewStatus } from "@prisma/client";
import { requireVideoReviewOperator } from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePagination, paginationResult } from "@/lib/pagination";

const statuses = ["PENDING", "APPROVED", "REJECTED"] as const;

export async function GET(request: Request) {
  try {
    const operator = await requireVideoReviewOperator();
    const url = new URL(request.url);
    const { page, take, skip } = parsePagination(url, 50, 100);
    const requestedStatus = url.searchParams.get("status");
    const status = statuses.find((value) => value === requestedStatus) ?? "PENDING";
    const where = {
      status: status as VideoSecondaryReviewStatus,
      ...(operator.role === "REVIEWER" ? { reviewerId: operator.id } : {}),
    };
    const [reviews, total] = await Promise.all([
      db.videoSecondaryReview.findMany({
        where,
        include: {
          reviewer: { select: { id: true, kuaishouId: true, nickname: true, role: true } },
          video: { include: { user: { select: { id: true, kuaishouId: true, nickname: true } } } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip,
        take,
      }),
      db.videoSecondaryReview.count({ where }),
    ]);
    return NextResponse.json({ reviews, pagination: paginationResult(page, take, total) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

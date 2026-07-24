import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePagination, paginationResult } from "@/lib/pagination";

const historyStatuses = ["APPROVED", "REJECTED", "REVOKED", "FAILED"] as const;

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const { page, take, skip } = parsePagination(url, 50, 100);
    const search = url.searchParams.get("search")?.trim();
    const requestedStatus = url.searchParams.get("status");
    const status = historyStatuses.find((value) => value === requestedStatus);
    const where = {
      status: { in: status ? [status] : [...historyStatuses] },
      ...(search ? {
        OR: [
          { sourceUrl: { contains: search, mode: "insensitive" as const } },
          { photoId: { contains: search, mode: "insensitive" as const } },
          { fetchedOwner: { contains: search, mode: "insensitive" as const } },
          { reviewReason: { contains: search, mode: "insensitive" as const } },
          { user: { is: { kuaishouId: { contains: search, mode: "insensitive" as const } } } },
          { user: { is: { nickname: { contains: search, mode: "insensitive" as const } } } },
        ],
      } : {}),
    };
    const [videos, total] = await Promise.all([
      db.videoSubmission.findMany({
        where,
        include: { user: { select: { kuaishouId: true, nickname: true } } },
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      db.videoSubmission.count({ where }),
    ]);
    return NextResponse.json({ videos, pagination: paginationResult(page, take, total) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

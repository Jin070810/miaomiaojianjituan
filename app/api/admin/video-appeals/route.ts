import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePagination, paginationResult } from "@/lib/pagination";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const { page, take, skip } = parsePagination(url, 50, 100);
    const search = url.searchParams.get("search")?.trim();
    const where = {
      status: "PENDING" as const,
      ...(search ? {
        OR: [
          { reason: { contains: search, mode: "insensitive" as const } },
          { video: { is: { sourceUrl: { contains: search, mode: "insensitive" as const } } } },
          { user: { is: { kuaishouId: { contains: search, mode: "insensitive" as const } } } },
          { user: { is: { nickname: { contains: search, mode: "insensitive" as const } } } },
        ],
      } : {}),
    };
    const [appeals, total] = await Promise.all([
      db.videoAppeal.findMany({
        where,
        include: {
          video: true,
          user: { select: { id: true, kuaishouId: true, nickname: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip,
        take,
      }),
      db.videoAppeal.count({ where }),
    ]);
    return NextResponse.json({ appeals, pagination: paginationResult(page, take, total) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

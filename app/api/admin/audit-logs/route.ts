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
    const where = search ? {
      OR: [
        { action: { contains: search, mode: "insensitive" as const } },
        { entity: { contains: search, mode: "insensitive" as const } },
        { entityId: { contains: search, mode: "insensitive" as const } },
        { actor: { is: { kuaishouId: { contains: search, mode: "insensitive" as const } } } },
        { actor: { is: { nickname: { contains: search, mode: "insensitive" as const } } } },
      ],
    } : undefined;
    const [audit, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
        include: { actor: { select: { kuaishouId: true, nickname: true } } },
      }),
      db.auditLog.count({ where }),
    ]);
    return NextResponse.json({ audit, pagination: paginationResult(page, take, total) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

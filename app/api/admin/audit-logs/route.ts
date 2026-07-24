import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePagination, paginationResult } from "@/lib/pagination";
import { presentAuditLog } from "@/lib/audit";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const { page, take, skip } = parsePagination(url, 50, 100);
    const search = url.searchParams.get("search")?.trim();
    const action = url.searchParams.get("action")?.trim() || undefined;
    const actionPrefix = url.searchParams.get("actionPrefix")?.trim() || undefined;
    const entity = url.searchParams.get("entity")?.trim() || undefined;
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const where = {
      ...(action ? { action } : actionPrefix ? { action: { startsWith: actionPrefix } } : {}),
      ...(entity ? { entity } : {}),
      ...((from && !Number.isNaN(Date.parse(from))) || (to && !Number.isNaN(Date.parse(to)))
        ? { createdAt: { ...(from && !Number.isNaN(Date.parse(from)) ? { gte: new Date(from) } : {}), ...(to && !Number.isNaN(Date.parse(to)) ? { lte: new Date(to) } : {}) } }
        : {}),
      ...(search ? {
        OR: [
          { action: { contains: search, mode: "insensitive" as const } },
          { entity: { contains: search, mode: "insensitive" as const } },
          { entityId: { contains: search, mode: "insensitive" as const } },
          { reason: { contains: search, mode: "insensitive" as const } },
          { requestId: { contains: search, mode: "insensitive" as const } },
          { actor: { is: { kuaishouId: { contains: search, mode: "insensitive" as const } } } },
          { actor: { is: { nickname: { contains: search, mode: "insensitive" as const } } } },
        ],
      } : {}),
    };
    const [audit, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
        include: { actor: { select: { kuaishouId: true, nickname: true, role: true } } },
      }),
      db.auditLog.count({ where }),
    ]);
    return NextResponse.json({
      audit: audit.map((row) => presentAuditLog(row)),
      filters: { action: action ?? null, actionPrefix: actionPrefix ?? null, entity: entity ?? null, from: from ?? null, to: to ?? null },
      pagination: paginationResult(page, take, total),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

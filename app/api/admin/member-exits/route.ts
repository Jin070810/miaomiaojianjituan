import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { paginationResult, parsePagination } from "@/lib/pagination";
import { listVoluntaryMemberExits } from "@/lib/member-voluntary-exit";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const { page, take, skip } = parsePagination(url, 50, 100);
    const result = await listVoluntaryMemberExits({
      skip,
      take,
      search: url.searchParams.get("search")?.trim(),
    });
    return NextResponse.json({
      exits: result.exits,
      pagination: paginationResult(page, take, result.total),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

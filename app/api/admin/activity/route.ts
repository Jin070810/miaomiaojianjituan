import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getAdminEntityActivity } from "@/lib/admin-workbench";
import { parsePagination } from "@/lib/pagination";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const entity = url.searchParams.get("entity")?.trim() ?? "";
    const entityId = url.searchParams.get("entityId")?.trim() ?? "";
    if (!entity || !entityId || entity.length > 80 || entityId.length > 200) return NextResponse.json({ error: "活动记录参数不正确" }, { status: 400 });
    const { page, take } = parsePagination(url, 20, 100);
    return NextResponse.json(await getAdminEntityActivity(entity, entityId, page, take), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

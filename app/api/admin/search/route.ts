import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { searchAdminRecords } from "@/lib/admin-workbench";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length > 100) return NextResponse.json({ error: "搜索内容不能超过 100 个字符" }, { status: 400 });
    return NextResponse.json(await searchAdminRecords(query), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

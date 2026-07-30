import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getAdminWorkbench, parseWorkbenchRange } from "@/lib/admin-workbench";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const range = parseWorkbenchRange(new URL(request.url).searchParams.get("range"));
    return NextResponse.json(await getAdminWorkbench(range), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

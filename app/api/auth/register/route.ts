import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "跨站请求已拒绝" }, { status: 403 });
  }
  return NextResponse.json({ error: "公开注册已关闭，请使用专属入团链接申请" }, { status: 410 });
}

import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "退出失败" }, { status: 403 });
  }
}

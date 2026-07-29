import { NextResponse } from "next/server";
import { requirePasswordResetApprover } from "@/lib/auth";
import { listPendingPasswordResetRequests } from "@/lib/password-reset-requests";

export async function GET() {
  try {
    await requirePasswordResetApprover();
    return NextResponse.json({ requests: await listPendingPasswordResetRequests() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

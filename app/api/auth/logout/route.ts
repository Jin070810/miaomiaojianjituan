import { NextResponse } from "next/server";
import { currentUser, destroySession } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, getClientIp, requestId } from "@/lib/security";
import { writeAuditLog } from "@/lib/audit";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    await destroySession();
    if (user) {
      await writeAuditLog(db, {
          actorId: user.id,
          action: "LOGOUT",
          entity: "Authentication",
          entityId: user.id,
          ip: getClientIp(request),
          requestId: requestId(),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "退出失败" }, { status: 403 });
  }
}

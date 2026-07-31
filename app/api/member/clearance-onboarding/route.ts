import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security";

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const now = new Date();
    const updated = await db.memberEligibility.updateMany({
      where: { userId: user.id, status: "ACTIVE", onboardingSeenAt: null },
      data: { onboardingSeenAt: now },
    });
    return NextResponse.json({ acknowledged: updated.count > 0, acknowledgedAt: now });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "确认说明失败" }, { status: 400 });
  }
}

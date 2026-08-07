import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { markBirthdayOnboardingSeen } from "@/lib/birthdays";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin, rateLimitResponse } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await enforceRateLimit(`birthday-onboarding:${user.id}`, 5, 60);
    const profile = await markBirthdayOnboardingSeen(user.id);
    return NextResponse.json({ onboardingSeenAt: profile.onboardingSeenAt });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof Error ? error.message : "生日权益引导保存失败" }, { status: 400 });
  }
}

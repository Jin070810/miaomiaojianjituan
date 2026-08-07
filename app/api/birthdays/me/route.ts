import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { BIRTHDAY_DRAW_POLICY_VERSION, BIRTHDAY_WISH_PRESETS, updateMemberBirthday } from "@/lib/birthdays";
import { assertSameOrigin, decryptSensitive, getClientIp, rateLimitResponse } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isMemberParticipantRole } from "@/lib/member-roles";
import { operationSwitchDefinitions, operationSwitchEnabled } from "@/lib/operation-switches";

const schema = z.object({
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  visibleOnWall: z.boolean().optional(),
}).refine((input) => input.birthday !== undefined || input.visibleOnWall !== undefined, "没有需要更新的生日资料");

function revealBirthday(value: string | null) {
  if (!value) return null;
  try { return decryptSensitive(value); } catch { return null; }
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!isMemberParticipantRole(user.role)) return NextResponse.json({ error: "当前账号不能参加生日星愿" }, { status: 403 });
  if (!(await operationSwitchEnabled("BIRTHDAY_PROGRAM"))) return NextResponse.json({ error: operationSwitchDefinitions.BIRTHDAY_PROGRAM.disabledMessage }, { status: 503 });
  const [profile, benefits, wishes] = await Promise.all([
    db.memberBirthdayProfile.findUnique({ where: { userId: user.id } }),
    db.birthdayAnnualBenefit.findMany({ where: { userId: user.id }, include: { prize: { include: { gift: { select: { id: true, name: true, kind: true, imageUrl: true, fulfillmentFields: true } }, redemptionOrder: { select: { id: true, status: true } } } } }, orderBy: { benefitYear: "desc" }, take: 5 }),
    db.birthdayWish.findMany({ where: { recipientId: user.id }, include: { sender: { select: { id: true, nickname: true, avatarUrl: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return NextResponse.json({
    profile: profile ? {
      birthday: revealBirthday(profile.birthDateEnc),
      month: profile.birthMonth,
      day: profile.birthDay,
      pendingBirthday: revealBirthday(profile.pendingBirthDateEnc),
      pendingMonth: profile.pendingBirthMonth,
      pendingDay: profile.pendingBirthDay,
      pendingEffectiveAt: profile.pendingEffectiveAt,
      visibleOnWall: profile.visibleOnWall,
      lastSelfChangeAt: profile.lastSelfChangeAt,
      nextSelfChangeAt: profile.lastSelfChangeAt ? new Date(profile.lastSelfChangeAt.getTime() + 365 * 86_400_000) : null,
    } : null,
    benefits,
    wishes,
    presets: BIRTHDAY_WISH_PRESETS,
    drawPolicyVersion: BIRTHDAY_DRAW_POLICY_VERSION,
  });
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await enforceRateLimit(`birthday-profile:${user.id}`, 10, 3600);
    const input = schema.parse(await request.json());
    await updateMemberBirthday({ ...input, userId: user.id, ip: getClientIp(request) });
    return GET();
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof z.ZodError ? "生日资料格式不正确" : error instanceof Error ? error.message : "生日资料保存失败" }, { status: 400 });
  }
}

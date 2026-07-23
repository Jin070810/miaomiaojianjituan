import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin, getClientIp, rateLimitResponse } from "@/lib/security";

const updateSchema = z.object({
  nickname: z.string().trim().min(1).max(80).optional(),
  guildStatus: z.literal("已入会").optional(),
}).refine((input) => Object.keys(input).length > 0, "没有需要更新的资料");

function safeUser(user: {
  id: string;
  kuaishouId: string;
  nickname: string;
  role: string;
  guildStatus: string | null;
  invited: boolean;
  account?: { balance: number } | null;
}) {
  return {
    id: user.id,
    kuaishouId: user.kuaishouId,
    nickname: user.nickname,
    role: user.role,
    guildStatus: user.guildStatus,
    invited: user.invited,
    balance: user.account?.balance ?? 0,
  };
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user: safeUser(user) });
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await enforceRateLimit(`profile-update:${user.id}`, 10, 3600);
    const input = updateSchema.parse(await request.json());
    if (input.guildStatus === "已入会" && !user.invited && !["已邀请", "已入会"].includes(user.guildStatus ?? "")) {
      return NextResponse.json({ error: "当前没有可确认的公会邀请" }, { status: 400 });
    }
    const updated = await db.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id: user.id },
        data: {
          ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
          ...(input.guildStatus !== undefined ? { guildStatus: input.guildStatus, invited: true } : {}),
        },
        include: { account: true },
      });
      if (input.guildStatus && input.guildStatus !== user.guildStatus) {
        await tx.guildStatusHistory.create({
          data: { userId: user.id, status: input.guildStatus, reason: "成员自行确认入会" },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "PROFILE_UPDATED",
          entity: "User",
          entityId: user.id,
          beforeValue: { nickname: user.nickname, guildStatus: user.guildStatus, invited: user.invited },
          afterValue: input,
          ip: getClientIp(request),
        },
      });
      return next;
    });
    return NextResponse.json({ user: safeUser(updated) });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof z.ZodError ? "成员资料格式不正确" : error instanceof Error ? error.message : "更新失败" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertSameOrigin, getClientIp, rateLimitResponse, requestId, verifyPassword } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { getLoginClearanceStatus } from "@/lib/member-clearance";

const schema = z.object({
  kuaishouId: z.string().trim().min(2).max(80),
  password: z.string().min(6).max(128),
});

function maskLoginId(value: string) {
  const normalized = value.trim();
  if (normalized.length <= 4) return `${normalized.slice(0, 1)}***`;
  return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = schema.parse(await request.json());
    await enforceRateLimit(`login:${getClientIp(request)}:${input.kuaishouId.toLowerCase()}`, 8, 900);
    const auditRequestId = requestId();
    const user = await db.user.findFirst({ where: { kuaishouId: { equals: input.kuaishouId, mode: "insensitive" } } });
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
      await writeAuditLog(db, {
          action: "LOGIN_FAILED",
          entity: "Authentication",
          entityId: user?.id,
          afterValue: {
            attemptedKuaishouId: maskLoginId(user?.kuaishouId ?? input.kuaishouId),
            reason: user ? "INVALID_PASSWORD" : "UNKNOWN_ACCOUNT",
          },
          ip: getClientIp(request),
          requestId: auditRequestId,
      });
      return NextResponse.json({ error: "快手ID或密码不正确" }, { status: 401 });
    }
    if (!user.active) {
      await writeAuditLog(db, {
          action: "LOGIN_FAILED",
          entity: "Authentication",
          entityId: user.id,
          afterValue: { attemptedKuaishouId: maskLoginId(user.kuaishouId), reason: "ACCOUNT_INACTIVE" },
          ip: getClientIp(request),
          requestId: auditRequestId,
      });
      const clearance = await getLoginClearanceStatus(user.id);
      if (clearance && ["COOLDOWN", "REJOIN_PENDING", "REJOIN_REJECTED"].includes(clearance.status)) {
        const availableAt = clearance.status === "COOLDOWN" ? clearance.cooldownEndsAt : clearance.rejoinRetryAt;
        return NextResponse.json({
          error: clearance.status === "REJOIN_PENDING" ? "重新加入申请正在审核" : "账号已因长期无有效产出被清退",
          code: "MEMBER_CLEARED",
          status: clearance.status,
          availableAt: availableAt?.toISOString() ?? null,
        }, { status: 403 });
      }
      return NextResponse.json({ error: "账号已停用，请联系管理员" }, { status: 403 });
    }
    await createSession(user.id);
    await writeAuditLog(db, {
        actorId: user.id,
        action: "LOGIN_SUCCEEDED",
        entity: "Authentication",
        entityId: user.id,
        afterValue: { role: user.role },
        ip: getClientIp(request),
        requestId: auditRequestId,
    });
    return NextResponse.json({
      user: { id: user.id, kuaishouId: user.kuaishouId, nickname: user.nickname, role: user.role },
    });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    console.error("[auth/login]", error);
    return NextResponse.json({ error: error instanceof z.ZodError ? "登录信息格式不正确" : "登录失败" }, { status: 400 });
  }
}

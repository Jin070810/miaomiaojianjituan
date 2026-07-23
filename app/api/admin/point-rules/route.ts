import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { getVideoPointRule } from "@/lib/point-rules";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin, getClientIp, rateLimitResponse, requireIdempotency } from "@/lib/security";

const ruleSchema = z.object({
  minimumLikes: z.number().int().min(1).max(1_000_000),
  fixedTierMaxLikes: z.number().int().min(1).max(10_000_000),
  fixedTierPoints: z.number().int().min(1).max(1_000_000),
  likesDivisor: z.number().int().min(1).max(10_000),
  maximumPoints: z.number().int().min(1).max(10_000_000),
  submissionWindowDays: z.number().int().min(1).max(30),
}).refine((rule) => rule.fixedTierMaxLikes >= rule.minimumLikes, {
  message: "固定积分档上限不能低于最低点赞量",
  path: ["fixedTierMaxLikes"],
}).refine((rule) => rule.maximumPoints >= rule.fixedTierPoints, {
  message: "积分上限不能低于固定档积分",
  path: ["maximumPoints"],
});

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ rule: await getVideoPointRule() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    await enforceRateLimit(`admin-point-rule:${admin.id}`, 20, 3600);
    const idempotencyKey = requireIdempotency(request);
    const input = ruleSchema.parse(await request.json());
    const rule = await db.$transaction(async (tx) => {
      const repeated = await tx.auditLog.findFirst({
        where: { action: "VIDEO_POINT_RULE_UPDATED", requestId: idempotencyKey },
        orderBy: { createdAt: "desc" },
      });
      if (repeated) return tx.videoPointRule.findUniqueOrThrow({ where: { id: "default" } });
      const before = await getVideoPointRule(tx);
      const updated = await tx.videoPointRule.upsert({
        where: { id: "default" },
        create: { id: "default", ...input, updatedById: admin.id },
        update: { ...input, updatedById: admin.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "VIDEO_POINT_RULE_UPDATED",
          entity: "VideoPointRule",
          entityId: updated.id,
          beforeValue: before,
          afterValue: input,
          ip: getClientIp(request),
          requestId: idempotencyKey,
        },
      });
      return updated;
    });
    return NextResponse.json({ rule });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    const message = error instanceof z.ZodError
      ? error.issues[0]?.message ?? "积分规则格式不正确"
      : error instanceof Error ? error.message : "积分规则保存失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

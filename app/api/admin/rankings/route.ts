import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { settleRanking } from "@/lib/rankings";
import { decryptSensitive, assertSameOrigin, getClientIp } from "@/lib/security";

const settleSchema = z.object({ action: z.literal("settle"), type: z.enum(["week", "month"]) });

export async function GET() {
  try {
    await requireAdmin();
    const periods = await db.rankingPeriod.findMany({
      include: {
        entries: { orderBy: { rank: "asc" }, take: 100, include: { user: { select: { kuaishouId: true, nickname: true } } } },
        awards: { orderBy: { rank: "asc" }, include: { gift: true, user: { select: { kuaishouId: true, nickname: true } } } },
      },
      orderBy: { periodStart: "desc" },
      take: 24,
    });
    return NextResponse.json({
      periods: periods.map((period) => ({
        ...period,
        awards: period.awards.map(({ recipientPhoneEnc, recipientAddressEnc, ...award }) => ({
          ...award,
          recipientPhone: recipientPhoneEnc ? decryptSensitive(recipientPhoneEnc) : null,
          recipientAddress: recipientAddressEnc ? decryptSensitive(recipientAddressEnc) : null,
        })),
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const input = settleSchema.parse(await request.json());
    const result = await settleRanking(input.type);
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: "RANKING_SETTLEMENT_REQUESTED",
        entity: "RankingPeriod",
        entityId: result.period.id,
        afterValue: { type: input.type, settled: result.settled },
        ip: getClientIp(request),
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "结算参数不正确" : error instanceof Error ? error.message : "结算失败" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { listSettlementPeriods, previewRankingPeriod, settleRankingPeriod } from "@/lib/rankings";
import { decryptSensitive, assertSameOrigin, getClientIp } from "@/lib/security";

const settleSchema = z.object({
  action: z.literal("settle"),
  type: z.enum(["week", "month"]),
  periodStart: z.string().datetime({ offset: true }),
  rewards: z.array(z.object({
    rank: z.number().int().min(1).max(5),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
  })).max(5).superRefine((items, context) => {
    if (new Set(items.map((item) => item.rank)).size !== items.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "奖励名次不能重复" });
  }),
});

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const summaryView = new URL(request.url).searchParams.get("view") === "summary";
    const periods = await db.rankingPeriod.findMany({
      include: {
        entries: { orderBy: { rank: "asc" }, take: 100, include: { user: { select: { kuaishouId: true, nickname: true } } } },
        awards: { orderBy: { rank: "asc" }, include: { gift: true, user: { select: { kuaishouId: true, nickname: true } } } },
      },
      orderBy: { periodStart: "desc" },
      take: 120,
    });
    const candidates = await listSettlementPeriods();
    const previews = await Promise.all(candidates.map(async (period) => [period.id, await previewRankingPeriod({ type: period.type === "WEEK" ? "week" : "month", periodStart: period.periodStart })] as const));
    const previewById = new Map(previews);
    const candidateIds = new Set(candidates.map((period) => period.id));
    return NextResponse.json({
      periods: periods.map((period) => ({
        ...period,
        preview: previewById.get(period.id)?.rankings ?? [],
        settleable: candidateIds.has(period.id),
        awards: period.awards.map(({ recipientName, recipientPhoneEnc, recipientAddressEnc, ...award }) => summaryView ? ({
          ...award,
          recipientName: null,
          recipientPhone: null,
          recipientAddress: null,
          hasRecipientDetails: Boolean(recipientName && recipientPhoneEnc && recipientAddressEnc),
        }) : ({
          ...award,
          recipientName,
          recipientPhone: recipientPhoneEnc ? decryptSensitive(recipientPhoneEnc) : null,
          recipientAddress: recipientAddressEnc ? decryptSensitive(recipientAddressEnc) : null,
          hasRecipientDetails: Boolean(recipientName && recipientPhoneEnc && recipientAddressEnc),
        })),
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const input = settleSchema.parse(await request.json());
    const result = await settleRankingPeriod({
      type: input.type,
      periodStart: new Date(input.periodStart),
      rewards: input.rewards,
      actorId: admin.id,
      ip: getClientIp(request),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "结算参数不正确" : error instanceof Error ? error.message : "结算失败" }, { status: 400 });
  }
}

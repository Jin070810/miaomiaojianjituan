import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { adminAdjustPoints } from "@/lib/points";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin, getClientIp, rateLimitResponse, requireIdempotency } from "@/lib/security";

const adjustmentSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().int().min(-1_000_000).max(1_000_000).refine((amount) => amount !== 0),
  reason: z.string().trim().min(2).max(500),
});

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const page = Math.max(1, Math.floor(Number(url.searchParams.get("page") ?? 1) || 1));
    const take = Math.min(100, Math.max(10, Math.floor(Number(url.searchParams.get("take") ?? 50) || 50)));
    const search = url.searchParams.get("search")?.trim();
    const where = search
      ? {
          account: {
            user: {
              OR: [
                { kuaishouId: { contains: search, mode: "insensitive" as const } },
                { nickname: { contains: search, mode: "insensitive" as const } },
              ],
            },
          },
        }
      : undefined;
    const [rows, total] = await Promise.all([
      db.pointLedger.findMany({
        where,
        include: { account: { include: { user: { select: { id: true, kuaishouId: true, nickname: true, active: true } } } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * take,
        take,
      }),
      db.pointLedger.count({ where }),
    ]);
    return NextResponse.json({
      ledger: rows,
      pagination: { page, take, total, pages: Math.max(1, Math.ceil(total / take)) },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    await enforceRateLimit(`admin-points:${admin.id}`, 60, 60);
    const input = adjustmentSchema.parse(await request.json());
    const result = await adminAdjustPoints({
      ...input,
      actorId: admin.id,
      idempotencyKey: requireIdempotency(request),
      ip: getClientIp(request),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    const message = error instanceof z.ZodError ? "积分调整信息格式不正确" : error instanceof Error ? error.message : "积分调整失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { completeTransfer } from "@/lib/points";
import { assertSameOrigin, getClientIp, rateLimitResponse, requireIdempotency } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { parsePagination, paginationResult } from "@/lib/pagination";
import { operationSwitchDefinitions, operationSwitchEnabled } from "@/lib/operation-switches";

const schema = z.object({ receiverKuaishouId: z.string().trim().min(2).max(80), amount: z.number().int().positive().max(500000), note: z.string().trim().max(200).optional() });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (!(await operationSwitchEnabled("POINT_TRANSFERS"))) {
      return NextResponse.json({ error: operationSwitchDefinitions.POINT_TRANSFERS.disabledMessage }, { status: 503 });
    }
    await enforceRateLimit(`transfer:${user.id}`, 20, 60);
    const input = schema.parse(await request.json());
    const idempotencyKey = requireIdempotency(request);
    const receiver = await db.user.findFirst({ where: { kuaishouId: { equals: input.receiverKuaishouId, mode: "insensitive" }, active: true } });
    if (!receiver) return NextResponse.json({ error: "未找到转入成员" }, { status: 404 });
    const transfer = await completeTransfer({
      senderId: user.id,
      receiverId: receiver.id,
      amount: input.amount,
      note: input.note,
      idempotencyKey,
      ip: getClientIp(request),
    });
    return NextResponse.json({ transfer }, { status: 201 });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof Error ? error.message : "转账失败" }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { page, take, skip } = parsePagination(new URL(request.url), 50, 100);
  const where = { OR: [{ senderId: user.id }, { receiverId: user.id }] };
  const total = await db.transfer.count({ where });
  const transfers = await db.transfer.findMany({
    where,
    include: { sender: { select: { kuaishouId: true, nickname: true } }, receiver: { select: { kuaishouId: true, nickname: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
  });
  return NextResponse.json({ transfers, pagination: paginationResult(page, take, total) });
}

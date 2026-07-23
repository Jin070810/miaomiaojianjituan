import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePagination, paginationResult } from "@/lib/pagination";
import { assertSameOrigin } from "@/lib/security";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const url = new URL(request.url);
  const { page, take, skip } = parsePagination(url, 20, 50);
  const status = url.searchParams.get("status") === "unread" ? "unread" : "all";
  const where = { userId: user.id, ...(status === "unread" ? { readAt: null } : {}) };
  const [notifications, total, unreadCount] = await Promise.all([
    db.notification.findMany({
      where,
      include: { announcement: { select: { status: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
    }),
    db.notification.count({ where }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return NextResponse.json({
    notifications: notifications.map(({ announcement, ...notification }) => ({
      ...notification,
      withdrawn: announcement?.status === "WITHDRAWN",
      body: announcement?.status === "WITHDRAWN" ? "该公告已撤回" : notification.body,
    })),
    unreadCount,
    pagination: paginationResult(page, take, total),
  });
}

const readAllSchema = z.object({ action: z.literal("read-all") });

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    readAllSchema.parse(await request.json());
    const readAt = new Date();
    const result = await db.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt },
    });
    return NextResponse.json({ updated: result.count, readAt });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "通知操作参数不正确" : error instanceof Error ? error.message : "通知操作失败" }, { status: 400 });
  }
}

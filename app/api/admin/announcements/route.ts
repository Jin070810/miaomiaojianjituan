import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAnnouncementDraft } from "@/lib/notifications";
import { parsePagination, paginationResult } from "@/lib/pagination";
import { assertSameOrigin, getClientIp } from "@/lib/security";

const draftSchema = z.object({
  title: z.string().trim().min(1).max(80),
  content: z.string().trim().min(1).max(5000),
  audience: z.enum(["ALL", "SELECTED"]),
  recipientIds: z.array(z.string().min(1)).max(200).optional(),
});

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const { page, take, skip } = parsePagination(url, 20, 50);
    const status = url.searchParams.get("status");
    const where = status && ["DRAFT", "PUBLISHED", "WITHDRAWN"].includes(status)
      ? { status: status as "DRAFT" | "PUBLISHED" | "WITHDRAWN" }
      : undefined;
    const [announcements, total] = await Promise.all([
      db.announcement.findMany({
        where,
        include: {
          createdBy: { select: { id: true, nickname: true, kuaishouId: true } },
          recipients: { include: { user: { select: { id: true, nickname: true, kuaishouId: true } } } },
          _count: { select: { notifications: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      db.announcement.count({ where }),
    ]);
    return NextResponse.json({ announcements, pagination: paginationResult(page, take, total) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const input = draftSchema.parse(await request.json());
    if (input.audience === "SELECTED" && !input.recipientIds?.length) {
      return NextResponse.json({ error: "定向公告至少选择一名成员" }, { status: 400 });
    }
    const announcement = await createAnnouncementDraft({
      ...input,
      actorId: admin.id,
      ip: getClientIp(request),
    });
    return NextResponse.json({ announcement }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "公告信息格式不正确" : error instanceof Error ? error.message : "公告创建失败" }, { status: 400 });
  }
}

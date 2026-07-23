import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePagination, paginationResult } from "@/lib/pagination";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const { page, take, skip } = parsePagination(url, 50, 200);
    const search = url.searchParams.get("search")?.trim();
    const guild = url.searchParams.get("guild");
    const where = {
      ...(search ? { OR: [{ kuaishouId: { contains: search, mode: "insensitive" as const } }, { nickname: { contains: search, mode: "insensitive" as const } }] } : {}),
      ...(guild === "joined" ? { guildStatus: "已入会" } : guild === "pending" ? { NOT: { guildStatus: "已入会" } } : {}),
    };
    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        include: { account: true, _count: { select: { videos: true, redemptions: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      db.user.count({ where }),
    ]);
    return NextResponse.json({
      users: users.map(({ passwordHash, boundPhoneEnc, ...user }) => user),
      pagination: paginationResult(page, take, total),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

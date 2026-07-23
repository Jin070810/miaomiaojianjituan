import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.trim();
    const users = await db.user.findMany({
      where: search ? { OR: [{ kuaishouId: { contains: search, mode: "insensitive" } }, { nickname: { contains: search, mode: "insensitive" } }] } : undefined,
      include: { account: true, _count: { select: { videos: true, redemptions: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ users: users.map(({ passwordHash, boundPhoneEnc, ...user }) => user) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

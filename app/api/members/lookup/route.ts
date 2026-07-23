import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/security";

const schema = z.string().trim().min(2).max(80);

export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await enforceRateLimit(`member-lookup:${user.id}`, 30, 60);
    const value = schema.parse(new URL(request.url).searchParams.get("kuaishouId") ?? "");
    const member = await db.user.findFirst({
      where: { kuaishouId: { equals: value, mode: "insensitive" }, active: true },
      select: { id: true, kuaishouId: true, nickname: true },
    });
    if (!member) return NextResponse.json({ error: "未找到启用中的成员" }, { status: 404 });
    if (member.id === user.id) return NextResponse.json({ error: "不能向自己转账" }, { status: 400 });
    return NextResponse.json({ member });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof z.ZodError ? "快手 ID 格式不正确" : error instanceof Error ? error.message : "查询失败" }, { status: 400 });
  }
}

import { observeApi } from "@/lib/observe-api";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getMemberAchievements } from "@/lib/member-achievements";

async function handleGET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    return NextResponse.json(await getMemberAchievements(user.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "成长档案加载失败" }, { status: 500 });
  }
}

export const GET = observeApi("achievements_get", handleGET);

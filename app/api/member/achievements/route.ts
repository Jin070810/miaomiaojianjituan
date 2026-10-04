import { observeApi } from "@/lib/observe-api";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getMemberAchievements } from "@/lib/member-achievements";

async function handleGET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    return NextResponse.json(await getMemberAchievements(user.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    console.error("[member-achievements] archive read unavailable");
    return NextResponse.json({ error: "成长档案暂时不可用，请稍后重试" }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}

export const GET = observeApi("achievements_get", handleGET);

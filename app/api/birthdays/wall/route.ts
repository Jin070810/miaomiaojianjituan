import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getBirthdayWall } from "@/lib/birthdays";

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    return NextResponse.json(await getBirthdayWall(user.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "生日墙加载失败" }, { status: 503 });
  }
}

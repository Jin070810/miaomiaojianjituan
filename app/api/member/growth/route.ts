import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getMemberGrowth } from "@/lib/member-growth";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  try {
    return NextResponse.json(await getMemberGrowth(user.id));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "成长数据加载失败" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getLiveRanking, RankingKind } from "@/lib/rankings";

function parseKind(value: string | null): RankingKind {
  if (value === "month" || value === "likes") return "month";
  if (value === "total") return "total";
  return "week";
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const url = new URL(request.url);
  const kind = parseKind(url.searchParams.get("type") ?? url.searchParams.get("period"));
  const ranking = await getLiveRanking(kind, user.id);
  return NextResponse.json({
    ...ranking,
    labels: {
      week: "周更新排行榜",
      month: "月点赞量排行榜",
      total: "总积分排行榜",
    },
  });
}

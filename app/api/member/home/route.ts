import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { memberParticipantRoles } from "@/lib/member-roles";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const [recentLedger, videoStatusGroups, higherBalanceCount, approvedVideos] = await Promise.all([
    user.account
      ? db.pointLedger.findMany({
          where: { accountId: user.account.id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 3,
        })
      : [],
    db.videoSubmission.groupBy({
      by: ["status"],
      where: { userId: user.id },
      _count: { id: true },
    }),
    db.pointAccount.count({ where: { balance: { gt: user.account?.balance ?? 0 }, user: { active: true, role: { in: memberParticipantRoles } } } }),
    db.videoSubmission.count({ where: { userId: user.id, status: "APPROVED" } }),
  ]);
  const videoCounts = videoStatusGroups.reduce(
    (counts, row) => {
      counts.all += row._count.id;
      if (row.status === "APPROVED") counts.approved += row._count.id;
      if (row.status === "PROCESSING") counts.processing += row._count.id;
      if (["REJECTED", "FAILED", "PENDING_REVIEW", "REVOKED"].includes(row.status)) counts.exception += row._count.id;
      return counts;
    },
    { all: 0, approved: 0, processing: 0, exception: 0 },
  );

  return NextResponse.json({
    user: {
      id: user.id,
      kuaishouId: user.kuaishouId,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      role: user.role,
      guildStatus: user.guildStatus,
      invited: user.invited,
      balance: user.account?.balance ?? 0,
    },
    summary: { approvedVideos, rank: higherBalanceCount + 1, videoCounts },
    ledger: recentLedger,
  });
}

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { periodBounds } from "@/lib/rankings";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const startOfMonth = periodBounds("month").start;

  const [ledger, videos, gifts, orders, transfers, totalRank, monthlyIncome, videoStats, monthlyVideoStats, videoStatusGroups, higherBalanceCount] = await Promise.all([
    user.account
      ? db.pointLedger.findMany({
          where: { accountId: user.account.id },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : [],
    db.videoSubmission.findMany({
      where: { userId: user.id },
      include: { appeals: { orderBy: { createdAt: "desc" }, take: 3 } },
      orderBy: { submittedAt: "desc" },
      take: 50,
    }),
    db.gift.findMany({
      where: { active: true },
      orderBy: [{ stock: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    db.redemptionOrder.findMany({
      where: { userId: user.id },
      include: { gift: { select: { name: true, kind: true, imageUrl: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.transfer.findMany({
      where: { OR: [{ senderId: user.id }, { receiverId: user.id }] },
      include: {
        sender: { select: { kuaishouId: true, nickname: true } },
        receiver: { select: { kuaishouId: true, nickname: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.pointAccount.findMany({
      where: { user: { active: true } },
      include: { user: { select: { id: true, kuaishouId: true, nickname: true, avatarUrl: true } } },
      orderBy: { balance: "desc" },
      take: 20,
    }),
    user.account
      ? db.pointLedger.aggregate({
          where: { accountId: user.account.id, amount: { gt: 0 }, createdAt: { gte: startOfMonth } },
          _sum: { amount: true },
        })
      : null,
    db.videoSubmission.aggregate({
      where: { userId: user.id, status: "APPROVED" },
      _count: { id: true },
      _sum: { points: true, likes: true },
    }),
    db.videoSubmission.aggregate({
      where: { userId: user.id, status: "APPROVED", submittedAt: { gte: startOfMonth } },
      _count: { id: true },
    }),
    db.videoSubmission.groupBy({
      by: ["status"],
      where: { userId: user.id },
      _count: { id: true },
    }),
    db.pointAccount.count({ where: { balance: { gt: user.account?.balance ?? 0 }, user: { active: true } } }),
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
    summary: {
      monthlyIncome: monthlyIncome?._sum.amount ?? 0,
      approvedVideos: videoStats._count.id,
      monthlyApprovedVideos: monthlyVideoStats._count.id,
      videoPoints: videoStats._sum.points ?? 0,
      totalLikes: videoStats._sum.likes ?? 0,
      averageLikes: videoStats._count.id > 0 ? Math.floor((videoStats._sum.likes ?? 0) / videoStats._count.id) : 0,
      rank: higherBalanceCount + 1,
      videoCounts,
    },
    ledger,
    videos,
    gifts,
    orders: orders.map(({ recipientPhoneEnc, recipientAddressEnc, cashQrCodeUrl, ...order }) => ({
      ...order,
      hasRecipientPhone: Boolean(recipientPhoneEnc),
      hasRecipientAddress: Boolean(recipientAddressEnc),
      hasCashQrCode: Boolean(cashQrCodeUrl),
    })),
    transfers,
    leaderboard: totalRank.map((item, index) => ({
      rank: index + 1,
      userId: item.user.id,
      kuaishouId: item.user.kuaishouId,
      nickname: item.user.nickname,
      avatarUrl: item.user.avatarUrl,
      points: item.balance,
      current: item.user.id === user.id,
    })),
  });
}

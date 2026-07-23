import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { periodBounds } from "@/lib/rankings";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const startOfMonth = periodBounds("month").start;

  const [ledger, videos, gifts, orders, transfers, totalRank, monthlyIncome, videoStats, higherBalanceCount] = await Promise.all([
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
      include: { user: { select: { id: true, kuaishouId: true, nickname: true } } },
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
    db.pointAccount.count({ where: { balance: { gt: user.account?.balance ?? 0 }, user: { active: true } } }),
  ]);

  return NextResponse.json({
    user: {
      id: user.id,
      kuaishouId: user.kuaishouId,
      nickname: user.nickname,
      role: user.role,
      guildStatus: user.guildStatus,
      invited: user.invited,
      balance: user.account?.balance ?? 0,
    },
    summary: {
      monthlyIncome: monthlyIncome?._sum.amount ?? 0,
      approvedVideos: videoStats._count.id,
      videoPoints: videoStats._sum.points ?? 0,
      totalLikes: videoStats._sum.likes ?? 0,
      rank: higherBalanceCount + 1,
    },
    ledger,
    videos,
    gifts,
    orders: orders.map(({ recipientPhoneEnc, recipientAddressEnc, ...order }) => ({
      ...order,
      hasRecipientPhone: Boolean(recipientPhoneEnc),
      hasRecipientAddress: Boolean(recipientAddressEnc),
    })),
    transfers,
    leaderboard: totalRank.map((item, index) => ({
      rank: index + 1,
      userId: item.user.id,
      kuaishouId: item.user.kuaishouId,
      nickname: item.user.nickname,
      points: item.balance,
      current: item.user.id === user.id,
    })),
  });
}

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getCurrentWeeklyChallenge } from "@/lib/weekly-challenges";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const challenge = await getCurrentWeeklyChallenge(user.id);
  if (!challenge) return NextResponse.json({ challenge: null });
  return NextResponse.json({
    challenge: {
      id: challenge.id,
      type: challenge.type,
      status: challenge.status,
      title: challenge.title,
      description: challenge.description,
      aiReason: challenge.aiReason,
      baselineVideoCount: challenge.baselineVideoCount,
      baselineLikes: challenge.baselineLikes,
      targetVideoCount: challenge.targetVideoCount,
      targetLikes: challenge.targetLikes,
      rewardPoints: challenge.rewardPoints,
      rewardTiers: challenge.progress.rewardTiers,
      claimedRewardPoints: challenge.progress.claimedRewardPoints,
      claimedTier: challenge.progress.claimedTier,
      completedAt: challenge.completedAt,
      claimedAt: challenge.claimedAt,
      reversedAt: challenge.reversedAt,
      progress: challenge.progress,
      rewardsEnabled: challenge.rewardsEnabled,
      claimable: challenge.claimable,
      claimableRewardPoints: challenge.progress.claimableRewardPoints,
      raceEnded: challenge.raceEnded,
      period: {
        periodStart: challenge.period.periodStart,
        periodEnd: challenge.period.periodEnd,
        claimEndsAt: challenge.period.claimEndsAt,
        raceReward: challenge.period.raceReward,
      },
    },
  });
}

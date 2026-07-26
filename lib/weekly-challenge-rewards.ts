import { Prisma, WeeklyChallengeType } from "@prisma/client";
import { z } from "zod";

export const MIN_PERSONAL_REWARD = 100;
export const MIN_FINAL_REWARD = 300;
export const MAX_PERSONAL_REWARD = 1_000;
export const REWARD_POLICY_VERSION = "tiered-v2-hard-combined";

export type RewardProfile = {
  baselineVideoCount: number;
  baselineLikes: number;
  bestVideoCount: number;
  bestLikes: number;
  newMember: boolean;
};

export type RewardTier = {
  label: string;
  targetVideoCount: number | null;
  targetLikes: number | null;
  rewardPoints: number;
};

const rewardTierSchema = z.object({
  label: z.string().trim().min(1).max(20),
  targetVideoCount: z.number().int().positive().nullable(),
  targetLikes: z.number().int().positive().nullable(),
  rewardPoints: z.number().int().min(MIN_PERSONAL_REWARD).max(MAX_PERSONAL_REWARD),
});

export function targetBounds(profile: RewardProfile) {
  const minimumVideos = Math.max(
    profile.newMember ? 2 : 1,
    profile.baselineVideoCount + 1,
    Math.ceil(profile.baselineVideoCount * 1.2),
  );
  const maximumVideos = Math.max(
    minimumVideos + 4,
    Math.ceil(profile.baselineVideoCount * 3.5),
    Math.ceil(profile.bestVideoCount * 2.5),
  );
  const minimumLikes = Math.max(
    profile.newMember ? 400 : 200,
    profile.baselineLikes + 200,
    Math.ceil(profile.baselineLikes * 1.2),
  );
  const maximumLikes = Math.max(
    minimumLikes + 800,
    Math.ceil(profile.baselineLikes * 4),
    Math.ceil(profile.bestLikes * 2.5),
  );
  return { minimumVideos, maximumVideos, minimumLikes, maximumLikes };
}

export function difficultyForTargets(
  profile: Pick<RewardProfile, "baselineVideoCount" | "baselineLikes">,
  targetVideoCount: number | null,
  targetLikes: number | null,
  type: WeeklyChallengeType,
) {
  const videoDifficulty = targetVideoCount === null
    ? 0
    : Math.floor(targetVideoCount * 100 / Math.max(1, profile.baselineVideoCount));
  const likesDifficulty = targetLikes === null
    ? 0
    : Math.floor(targetLikes * 100 / Math.max(200, profile.baselineLikes));
  return type === "COMBINED"
    ? Math.floor((videoDifficulty + likesDifficulty) / 2) + 15
    : Math.max(videoDifficulty, likesDifficulty);
}

export function rewardForDifficulty(difficultyScore: number) {
  return Math.min(
    MAX_PERSONAL_REWARD,
    Math.max(MIN_FINAL_REWARD, Math.floor(difficultyScore * 4 / 10) * 10),
  );
}

export function buildRewardTiers(
  profile: RewardProfile,
  task: {
    type: WeeklyChallengeType;
    targetVideoCount: number | null;
    targetLikes: number | null;
  },
): RewardTier[] {
  const bounds = targetBounds(profile);
  const hardVideoFloor = Math.max(
    bounds.minimumVideos + 4,
    profile.bestVideoCount + (profile.bestVideoCount > 0 ? 2 : 4),
  );
  const hardLikesFloor = Math.max(
    bounds.minimumLikes + 800,
    profile.bestLikes + (profile.bestLikes > 0 ? Math.max(400, Math.ceil(profile.bestLikes * 0.25)) : 800),
  );
  const finalVideoTarget = Math.min(
    bounds.maximumVideos,
    Math.max(hardVideoFloor, task.targetVideoCount ?? 0),
  );
  const finalLikesTarget = Math.min(
    bounds.maximumLikes,
    Math.max(hardLikesFloor, task.targetLikes ?? 0),
  );
  const finalDifficulty = difficultyForTargets(
    profile,
    finalVideoTarget,
    finalLikesTarget,
    task.type,
  );
  const finalReward = rewardForDifficulty(finalDifficulty);
  const tierTwoReward = Math.min(
    finalReward - 10,
    Math.max(300, Math.floor(finalReward * 0.55 / 10) * 10),
  );
  const videoTargets = [finalVideoTarget - 2, finalVideoTarget - 1, finalVideoTarget];
  const likesTargets = [finalLikesTarget - 400, finalLikesTarget - 200, finalLikesTarget];
  return [
    { label: "够一够", targetVideoCount: videoTargets[0], targetLikes: likesTargets[0], rewardPoints: MIN_PERSONAL_REWARD },
    { label: "努努力", targetVideoCount: videoTargets[1], targetLikes: likesTargets[1], rewardPoints: tierTwoReward },
    { label: "很难但可试", targetVideoCount: videoTargets[2], targetLikes: likesTargets[2], rewardPoints: finalReward },
  ];
}

export function parseRewardTiers(value: Prisma.JsonValue | null | undefined): RewardTier[] | null {
  if (value === null || value === undefined) return null;
  const tiers = rewardTierSchema.array().min(1).max(3).parse(value);
  for (let index = 1; index < tiers.length; index += 1) {
    if (tiers[index].rewardPoints <= tiers[index - 1].rewardPoints) {
      throw new Error("周挑战阶梯奖励配置无效");
    }
  }
  return tiers;
}

export function rewardTiersForAssignment(assignment: {
  type: WeeklyChallengeType;
  targetVideoCount: number | null;
  targetLikes: number | null;
  rewardPoints: number;
  rewardTiers?: Prisma.JsonValue | null;
}) {
  return parseRewardTiers(assignment.rewardTiers) ?? [{
    label: "任务奖励",
    targetVideoCount: assignment.targetVideoCount,
    targetLikes: assignment.targetLikes,
    rewardPoints: assignment.rewardPoints,
  }];
}

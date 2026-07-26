import { Prisma, WeeklyChallengeType } from "@prisma/client";
import { z } from "zod";

export const MIN_PERSONAL_REWARD = 100;
export const MIN_FINAL_REWARD = 300;
export const MAX_PERSONAL_REWARD = 1_000;
export const REWARD_POLICY_VERSION = "tiered-v1";

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
    minimumVideos + 2,
    Math.min(
      Math.max(minimumVideos + 2, profile.baselineVideoCount * 3),
      Math.max(minimumVideos + 2, Math.ceil(profile.bestVideoCount * 2)),
    ),
  );
  const minimumLikes = Math.max(
    profile.newMember ? 400 : 200,
    profile.baselineLikes + 200,
    Math.ceil(profile.baselineLikes * 1.2),
  );
  const maximumLikes = Math.max(
    minimumLikes + 400,
    Math.min(
      Math.max(minimumLikes + 400, profile.baselineLikes * 4),
      Math.max(minimumLikes + 400, Math.ceil(profile.bestLikes * 2)),
    ),
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
  const finalVideoTarget = task.targetVideoCount === null
    ? null
    : Math.min(bounds.maximumVideos, Math.max(bounds.minimumVideos + 2, task.targetVideoCount));
  const finalLikesTarget = task.targetLikes === null
    ? null
    : Math.min(bounds.maximumLikes, Math.max(bounds.minimumLikes + 400, task.targetLikes));
  const finalDifficulty = difficultyForTargets(
    profile,
    finalVideoTarget,
    finalLikesTarget,
    task.type,
  );
  const finalReward = rewardForDifficulty(finalDifficulty);
  const tierTwoReward = Math.min(
    finalReward - 10,
    Math.max(200, Math.floor(finalReward / 2 / 10) * 10),
  );
  const videoTargets: Array<number | null> = finalVideoTarget === null
    ? [null, null, null]
    : [finalVideoTarget - 2, finalVideoTarget - 1, finalVideoTarget];
  const likesTargets: Array<number | null> = finalLikesTarget === null
    ? [null, null, null]
    : [
        bounds.minimumLikes,
        Math.min(finalLikesTarget - 200, Math.max(bounds.minimumLikes + 200, Math.floor(finalLikesTarget * 2 / 3))),
        finalLikesTarget,
      ];
  return [
    { label: "起步奖励", targetVideoCount: videoTargets[0], targetLikes: likesTargets[0], rewardPoints: MIN_PERSONAL_REWARD },
    { label: "进阶奖励", targetVideoCount: videoTargets[1], targetLikes: likesTargets[1], rewardPoints: tierTwoReward },
    { label: "冲刺奖励", targetVideoCount: videoTargets[2], targetLikes: likesTargets[2], rewardPoints: finalReward },
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

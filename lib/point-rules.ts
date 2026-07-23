import { Prisma } from "@prisma/client";
import { db } from "./db";

export type VideoPointRuleConfig = {
  minimumLikes: number;
  fixedTierMaxLikes: number;
  fixedTierPoints: number;
  likesDivisor: number;
  maximumPoints: number;
  submissionWindowDays: number;
};

export const DEFAULT_VIDEO_POINT_RULE: VideoPointRuleConfig = {
  minimumLikes: 200,
  fixedTierMaxLikes: 1000,
  fixedTierPoints: 50,
  likesDivisor: 2,
  maximumPoints: 5000,
  submissionWindowDays: 7,
};

export function asVideoPointRuleConfig(rule: {
  minimumLikes: number;
  fixedTierMaxLikes: number;
  fixedTierPoints: number;
  likesDivisor: number;
  maximumPoints: number;
  submissionWindowDays: number;
}): VideoPointRuleConfig {
  return {
    minimumLikes: rule.minimumLikes,
    fixedTierMaxLikes: rule.fixedTierMaxLikes,
    fixedTierPoints: rule.fixedTierPoints,
    likesDivisor: rule.likesDivisor,
    maximumPoints: rule.maximumPoints,
    submissionWindowDays: rule.submissionWindowDays,
  };
}

export async function getVideoPointRule(tx: Prisma.TransactionClient | typeof db = db) {
  const rule = await tx.videoPointRule.findUnique({ where: { id: "default" } });
  return rule ? asVideoPointRuleConfig(rule) : DEFAULT_VIDEO_POINT_RULE;
}

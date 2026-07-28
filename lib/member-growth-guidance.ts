export type GrowthActionKind = "claim" | "exceptions" | "challenge" | "submit" | "growth";

export type GrowthGuidanceInput = {
  exceptionCount: number;
  approvedVideosThisWeek: number | null;
  challenge: {
    status: string;
    claimable: boolean;
    claimableRewardPoints: number;
    rewardsEnabled: boolean;
    qualified: boolean;
  } | null;
};

export function chooseGrowthAction(input: GrowthGuidanceInput): {
  kind: GrowthActionKind;
  title: string;
  description: string;
} {
  const challengeActive = input.challenge
    && !["CLAIMED", "REVERSED", "EXPIRED"].includes(input.challenge.status);

  if (
    input.challenge
    && input.challenge.claimable
    && input.challenge.rewardsEnabled
    && input.challenge.claimableRewardPoints > 0
  ) {
    return {
      kind: "claim",
      title: `领取 ${input.challenge.claimableRewardPoints.toLocaleString()} 积分`,
      description: "阶段奖励已经达成，记得在领取截止时间前收下。",
    };
  }
  if (input.exceptionCount > 0) {
    return {
      kind: "exceptions",
      title: `看看 ${input.exceptionCount} 条异常切片`,
      description: "先确认驳回或失败原因，符合条件的记录可以提交申诉。",
    };
  }
  if (challengeActive && !input.challenge?.qualified) {
    return {
      kind: "challenge",
      title: "继续完成本周任务",
      description: "查看离下一阶段还差多少，再安排本周的切片。",
    };
  }
  if (input.approvedVideosThisWeek === 0) {
    return {
      kind: "submit",
      title: "提交本周第一条切片",
      description: "从第一条开始积累本周视频、点赞和视频积分。",
    };
  }
  return {
    kind: "growth",
    title: "查看完整成长记录",
    description: "回顾最近 8 周趋势，看看哪一周和哪条视频表现最好。",
  };
}

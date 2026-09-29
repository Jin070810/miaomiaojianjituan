// 成员端积分流水的统一展示标签，与 Prisma 的 LedgerType 枚举一一对应。
// 新增流水类型时在这里补一行，成员首页与记录页共用这一份，避免文案漂移。
const LEDGER_LABELS: Record<string, string> = {
  VIDEO_REWARD: "切片通过",
  TRANSFER_IN: "收到团友积分",
  TRANSFER_OUT: "送积分给团友",
  REDEMPTION: "兑换礼物",
  REDEMPTION_REFUND: "兑换退款",
  ADMIN_ADJUSTMENT: "积分调整",
  REVERSAL: "积分退回",
  WEEKLY_CHALLENGE_REWARD: "周挑战奖励",
  WEEKLY_RACE_REWARD: "周挑战竞速奖励",
  WEEKLY_CHALLENGE_REVERSAL: "周挑战奖励冲正",
  WEEKLY_RACE_REVERSAL: "竞速奖励冲正",
  MEMBER_CLEARANCE_FORFEIT: "清退积分清零",
  MEMBER_VOLUNTARY_EXIT_FORFEIT: "退团积分清零",
  BIRTHDAY_DRAW_REWARD: "生日星愿奖励",
  BIRTHDAY_VIDEO_BONUS: "生日作品加成",
};

export function ledgerLabel(type: string, note: string | null) {
  if (note) return note;
  return LEDGER_LABELS[type] ?? "积分变动";
}

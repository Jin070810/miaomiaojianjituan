import { db } from "./db";

type ClearanceOperationalRow = {
  enabled: boolean;
  activeMembers: number;
  dueWithin24Hours: number;
  dueWithin7Days: number;
  dueBalanceTotal: number;
  dueOpenOrders: number;
  overdueActive: number;
  missedWarnings: number;
  currentCleared: number;
  incorrectlyActive: number;
  nonzeroBalance: number;
  sessionsRemaining: number;
  openOrdersRemaining: number;
  unfinishedVideosRemaining: number;
  clearanceWithoutAudit: number;
};

export type ClearanceOperationalSnapshot = ClearanceOperationalRow & {
  checkedAt: string;
};

export async function getMemberClearanceOperationalSnapshot(now = new Date()): Promise<ClearanceOperationalSnapshot> {
  const within24Hours = new Date(now.getTime() + 86_400_000);
  const within7Days = new Date(now.getTime() + 7 * 86_400_000);
  const [row] = await db.$queryRaw<ClearanceOperationalRow[]>`
    WITH active_schedule AS (
      SELECT eligibility."id",
             eligibility."userId",
             eligibility."warning14SentAt",
             eligibility."warning3SentAt",
             policy."warningDays" AS warning_days,
             COALESCE(eligibility."lastOutputAt", eligibility."cycleStartedAt")
               + policy."inactivityDays" * INTERVAL '1 day' AS deadline
      FROM "MemberEligibility" AS eligibility
      JOIN "MembershipClearancePolicyVersion" AS policy
        ON policy."id" = eligibility."policyVersionId"
      JOIN "User" AS member ON member."id" = eligibility."userId"
      WHERE eligibility."status" = 'ACTIVE'
        AND member."active" = TRUE
        AND member."role" = 'MEMBER'
    ), current_cleared AS (
      SELECT eligibility."id", eligibility."userId"
      FROM "MemberEligibility" AS eligibility
      WHERE eligibility."status" IN ('COOLDOWN', 'REJOIN_PENDING', 'REJOIN_REJECTED')
    )
    SELECT
      COALESCE((SELECT setting."enabled" FROM "SystemSetting" AS setting WHERE setting."key" = 'MEMBER_CLEARANCE'), FALSE) AS enabled,
      (SELECT COUNT(*)::int FROM active_schedule) AS "activeMembers",
      (SELECT COUNT(*)::int FROM active_schedule WHERE deadline > ${now} AND deadline <= ${within24Hours}) AS "dueWithin24Hours",
      (SELECT COUNT(*)::int FROM active_schedule WHERE deadline > ${now} AND deadline <= ${within7Days}) AS "dueWithin7Days",
      (SELECT COALESCE(SUM(account."balance"), 0)::int
       FROM active_schedule AS schedule
       LEFT JOIN "PointAccount" AS account ON account."userId" = schedule."userId"
       WHERE schedule.deadline > ${now} AND schedule.deadline <= ${within7Days}) AS "dueBalanceTotal",
      (SELECT COUNT(*)::int
       FROM "RedemptionOrder" AS redemption
       JOIN active_schedule AS schedule ON schedule."userId" = redemption."userId"
       WHERE schedule.deadline > ${now} AND schedule.deadline <= ${within7Days}
         AND redemption."status" IN ('PENDING', 'APPROVED')) AS "dueOpenOrders",
      (SELECT COUNT(*)::int FROM active_schedule WHERE deadline <= ${now}) AS "overdueActive",
      (SELECT COUNT(*)::int
       FROM active_schedule
       WHERE deadline > ${now}
         AND (
           (deadline - make_interval(days => warning_days[1]) <= ${now} AND "warning14SentAt" IS NULL)
           OR (deadline - make_interval(days => warning_days[2]) <= ${now} AND "warning3SentAt" IS NULL)
         )) AS "missedWarnings",
      (SELECT COUNT(*)::int FROM current_cleared) AS "currentCleared",
      (SELECT COUNT(*)::int
       FROM current_cleared AS cleared
       JOIN "User" AS member ON member."id" = cleared."userId"
       WHERE member."active" = TRUE) AS "incorrectlyActive",
      (SELECT COUNT(*)::int
       FROM current_cleared AS cleared
       JOIN "PointAccount" AS account ON account."userId" = cleared."userId"
       WHERE account."balance" <> 0) AS "nonzeroBalance",
      (SELECT COUNT(*)::int
       FROM current_cleared AS cleared
       JOIN "Session" AS session ON session."userId" = cleared."userId") AS "sessionsRemaining",
      (SELECT COUNT(*)::int
       FROM current_cleared AS cleared
       JOIN "RedemptionOrder" AS redemption ON redemption."userId" = cleared."userId"
       WHERE redemption."status" IN ('PENDING', 'APPROVED')) AS "openOrdersRemaining",
      (SELECT COUNT(*)::int
       FROM current_cleared AS cleared
       JOIN "VideoSubmission" AS video ON video."userId" = cleared."userId"
       WHERE video."status" IN ('PROCESSING', 'PENDING_REVIEW', 'FAILED')) AS "unfinishedVideosRemaining",
      (SELECT COUNT(*)::int
       FROM "MemberEligibility" AS eligibility
       WHERE eligibility."clearedAt" IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM "AuditLog" AS audit
           WHERE audit."action" = 'MEMBER_AUTO_CLEARED'
             AND audit."entity" = 'MemberEligibility'
             AND audit."entityId" = eligibility."id"
         )) AS "clearanceWithoutAudit"
  `;
  return { ...row, checkedAt: now.toISOString() };
}

export function memberClearanceOperationalIssues(snapshot: ClearanceOperationalSnapshot) {
  if (!snapshot.enabled) return [];
  return [
    ...(snapshot.overdueActive ? [`${snapshot.overdueActive} 名成员已到期但仍处于有效状态`] : []),
    ...(snapshot.missedWarnings ? [`${snapshot.missedWarnings} 名成员的到期预警未按时发送`] : []),
    ...(snapshot.incorrectlyActive ? [`${snapshot.incorrectlyActive} 名清退成员的账号仍处于启用状态`] : []),
    ...(snapshot.nonzeroBalance ? [`${snapshot.nonzeroBalance} 名清退成员的积分余额未归零`] : []),
    ...(snapshot.sessionsRemaining ? [`清退成员仍保留 ${snapshot.sessionsRemaining} 个登录会话`] : []),
    ...(snapshot.openOrdersRemaining ? [`清退成员仍保留 ${snapshot.openOrdersRemaining} 个未完成订单`] : []),
    ...(snapshot.unfinishedVideosRemaining ? [`清退成员仍保留 ${snapshot.unfinishedVideosRemaining} 个未完成视频`] : []),
    ...(snapshot.clearanceWithoutAudit ? [`${snapshot.clearanceWithoutAudit} 条清退时间缺少自动清退审计`] : []),
  ];
}

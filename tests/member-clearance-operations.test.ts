import { describe, expect, it } from "vitest";
import { memberClearanceOperationalIssues, type ClearanceOperationalSnapshot } from "@/lib/member-clearance-operations";

const healthySnapshot: ClearanceOperationalSnapshot = {
  checkedAt: "2026-08-18T00:00:00.000Z",
  enabled: true,
  activeMembers: 381,
  dueWithin24Hours: 0,
  dueWithin7Days: 295,
  dueBalanceTotal: 39_786,
  dueOpenOrders: 0,
  overdueActive: 0,
  missedWarnings: 0,
  currentCleared: 0,
  incorrectlyActive: 0,
  nonzeroBalance: 0,
  sessionsRemaining: 0,
  openOrdersRemaining: 0,
  unfinishedVideosRemaining: 0,
  clearanceWithoutAudit: 0,
};

describe("member clearance operational checks", () => {
  it("keeps due-member exposure informational when invariants are healthy", () => {
    expect(memberClearanceOperationalIssues(healthySnapshot)).toEqual([]);
  });

  it("reports execution and post-clearance invariant violations", () => {
    expect(memberClearanceOperationalIssues({
      ...healthySnapshot,
      overdueActive: 2,
      missedWarnings: 3,
      nonzeroBalance: 1,
      sessionsRemaining: 2,
      clearanceWithoutAudit: 1,
    })).toEqual(expect.arrayContaining([
      "2 名成员已到期但仍处于有效状态",
      "3 名成员的到期预警未按时发送",
      "1 名清退成员的积分余额未归零",
      "清退成员仍保留 2 个登录会话",
      "1 条清退时间缺少自动清退审计",
    ]));
  });

  it("does not alert while the clearance switch is paused", () => {
    expect(memberClearanceOperationalIssues({ ...healthySnapshot, enabled: false, overdueActive: 2 })).toEqual([]);
  });
});

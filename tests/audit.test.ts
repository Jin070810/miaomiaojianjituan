import { describe, expect, it } from "vitest";
import { auditActionLabel, auditEntityLabel, auditSummary, presentAuditLog } from "@/lib/audit";

describe("审计日志展示", () => {
  it("translates known actions and keeps unknown codes visible", () => {
    expect(auditActionLabel("REDEMPTION_REJECTED")).toBe("驳回兑换订单");
    expect(auditActionLabel("OPERATION_SWITCH_UPDATED")).toBe("修改运营开关");
    expect(auditActionLabel("NEW_FUTURE_ACTION")).toBe("NEW_FUTURE_ACTION");
    expect(auditEntityLabel("RedemptionOrder")).toBe("兑换订单");
  });

  it("builds a transparent redemption summary", () => {
    expect(auditSummary({
      action: "REDEMPTION_REJECTED",
      entity: "RedemptionOrder",
      entityId: "order-1",
      beforeValue: { status: "APPROVED" },
      afterValue: { status: "REJECTED", refunded: 680 },
      reason: "暂时缺货",
      actor: { nickname: "管理员", kuaishouId: "admin", role: "ADMIN" },
    })).toContain("退回 680 积分");
  });

  it("redacts sensitive values in the detail response", () => {
    const row = presentAuditLog({
      id: "audit-1",
      action: "RECIPIENT_PROFILE_UPDATED",
      entity: "User",
      entityId: "user-1",
      beforeValue: { phone: "13800138000", address: "上海市" },
      afterValue: { phone: "13900139000", points: 20 },
      reason: null,
      ip: "127.0.0.1",
      requestId: "request-1",
      createdAt: new Date("2026-07-24T00:00:00.000Z"),
      actor: { nickname: "成员", kuaishouId: "member", role: "MEMBER" },
    });
    expect(row.beforeValue).toEqual({ phone: "[已脱敏]", address: "[已脱敏]" });
    expect(row.afterValue).toEqual({ phone: "[已脱敏]", points: 20 });
  });
});

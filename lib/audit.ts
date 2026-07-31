const actionLabels: Record<string, string> = {
  ANNOUNCEMENT_DRAFT_CREATED: "创建公告草稿",
  ANNOUNCEMENT_DRAFT_UPDATED: "修改公告草稿",
  ANNOUNCEMENT_PUBLISHED: "发布公告",
  ANNOUNCEMENT_WITHDRAWN: "撤回公告",
  ADMIN_LOGIN_FAILED: "登录失败",
  ADMIN_LOGIN_SUCCEEDED: "登录成功",
  ADMIN_PASSWORD_RESET: "重置成员密码",
  PASSWORD_RESET_REQUESTED: "提交密码找回申请",
  PASSWORD_RESET_APPROVED: "批准密码找回申请",
  PASSWORD_RESET_REJECTED: "拒绝密码找回申请",
  PASSWORD_RESET_EXPIRED: "密码找回申请已过期",
  ADMIN_POINTS_DEDUCTED: "扣减成员积分",
  ADMIN_POINTS_GRANTED: "发放成员积分",
  AVATAR_RESET: "恢复默认头像",
  AVATAR_UPDATED: "更新头像",
  CLAIM_SHIPPING: "填写领奖收货信息",
  FEISHU_GIFT_IMAGE_IMPORTED: "导入飞书礼品图片",
  GIFT_CREATED: "创建礼品",
  GIFT_DELETED: "删除礼品",
  GIFT_REORDERED: "调整礼品顺序",
  GIFT_UPDATED: "修改礼品",
  LOGIN_FAILED: "登录失败",
  LOGIN_SUCCEEDED: "登录成功",
  LOGOUT: "退出登录",
  OPERATION_SWITCH_UPDATED: "修改运营开关",
  ADMIN_CSV_EXPORTED: "导出脱敏数据",
  PASSWORD_CHANGED: "修改密码",
  PROFILE_UPDATED: "更新个人资料",
  RECIPIENT_PROFILE_UPDATED: "更新收货资料",
  REDEMPTION_APPROVED: "确认兑换订单",
  REDEMPTION_CREATED: "提交兑换订单",
  REDEMPTION_FULFILLED: "完成兑换发放",
  REDEMPTION_REJECTED: "驳回兑换订单",
  REDEMPTION_REFUNDED: "退款兑换订单",
  REDEMPTION_RECONCILIATION_COMPLETED: "完成订单维护对账",
  REDEMPTION_TRACKING_UPDATED: "更新快递单号",
  RANKING_AWARD_CLAIMED: "填写榜单领奖信息",
  RANKING_AWARD_UPDATED: "更新榜单奖励",
  RANKING_SETTLED: "完成榜单结算",
  TRANSFER_COMPLETED: "完成积分转账",
  USER_REGISTERED: "注册账号",
  USER_UPDATED: "更新成员资料",
  MEMBER_CLEARANCE_POLICY_CREATED: "创建成员清退规则版本",
  MEMBER_AUTO_CLEARED: "自动清退成员资格",
  MEMBER_REJOIN_REQUESTED: "提交重新加入申请",
  MEMBER_REJOIN_APPROVED: "批准重新加入申请",
  MEMBER_REJOIN_REJECTED: "驳回重新加入申请",
  VIDEO_APPROVED: "视频审核通过",
  VIDEO_APPEAL_APPROVED: "通过视频申诉",
  VIDEO_APPEAL_CREATED: "提交视频申诉",
  VIDEO_APPEAL_REJECTED: "驳回视频申诉",
  VIDEO_AUTO_REJECTED: "视频自动驳回",
  VIDEO_BULK_REPROCESS_REQUESTED: "批量重新抓取视频",
  VIDEO_ENQUEUE_FAILED: "视频入队失败",
  VIDEO_POINTS_ADJUSTED: "调整视频积分",
  VIDEO_POINT_RULE_UPDATED: "修改视频积分规则",
  VIDEO_REJECTED: "视频驳回",
  VIDEO_REPROCESS_ENQUEUE_FAILED: "视频重抓入队失败",
  VIDEO_REPROCESS_REQUESTED: "请求重新抓取视频",
  VIDEO_REVOKED: "撤销视频积分",
  VIDEO_SUBMITTED: "提交视频",
  VIDEO_WORKER_RECOVERY: "恢复视频任务",
};

const entityLabels: Record<string, string> = {
  Announcement: "公告",
  Authentication: "认证",
  Gift: "礼品",
  PointAccount: "积分账户",
  PointLedger: "积分流水",
  PasswordResetRequest: "密码找回申请",
  RankingAward: "榜单奖励",
  RankingPeriod: "榜单周期",
  RedemptionOrder: "兑换订单",
  RedemptionReconciliation: "兑换订单维护",
  SystemSetting: "系统设置",
  DataExport: "数据导出",
  Transfer: "积分转账",
  User: "成员",
  VideoAppeal: "视频申诉",
  VideoSubmission: "视频",
  MemberEligibility: "成员资格周期",
  MembershipClearancePolicyVersion: "成员清退规则",
  RejoinRequest: "重新加入申请",
};

const sensitiveKey = /(password|secret|session|phone|address|qrcode|cashqr|boundphone)/i;

type AuditWriter = Prisma.TransactionClient | PrismaClient;

export function writeAuditLog(
  tx: AuditWriter,
  input: {
    action: string;
    entity: string;
    actorId?: string | null;
    entityId?: string | null;
    beforeValue?: Prisma.InputJsonValue | null;
    afterValue?: Prisma.InputJsonValue | null;
    reason?: string | null;
    ip?: string | null;
    requestId?: string | null;
  },
) {
  return tx.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      beforeValue: input.beforeValue ?? undefined,
      afterValue: input.afterValue ?? undefined,
      reason: input.reason ?? null,
      ip: input.ip ?? null,
      requestId: input.requestId ?? null,
    },
  });
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveKey.test(key) ? "[已脱敏]" : sanitizeValue(item),
      ]),
    );
  }
  return value;
}

function numberFrom(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" ? raw : null;
}

function stringFrom(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function isSystemAction(action: string) {
  return [
    "VIDEO_AUTO_REJECTED",
    "VIDEO_WORKER_RECOVERY",
    "VIDEO_REPROCESS_REQUESTED",
    "VIDEO_BULK_REPROCESS_REQUESTED",
    "VIDEO_ENQUEUE_FAILED",
    "VIDEO_REPROCESS_ENQUEUE_FAILED",
    "VIDEO_APPROVED",
    "VIDEO_POINTS_ADJUSTED",
    "REDEMPTION_RECONCILIATION_COMPLETED",
    "RANKING_SETTLED",
    "MEMBER_AUTO_CLEARED",
  ].includes(action);
}

export function auditActionLabel(action: string) {
  return actionLabels[action] ?? action;
}

export function auditEntityLabel(entity: string) {
  return entityLabels[entity] ?? entity;
}

export function auditSummary(input: {
  action: string;
  entity: string;
  entityId: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  reason: string | null;
  actor: { nickname: string; kuaishouId: string; role: string } | null;
}) {
  const actor = input.actor?.nickname ?? (isSystemAction(input.action) ? "系统自动任务" : input.action === "LOGIN_FAILED" ? "未登录用户" : "历史详情有限");
  const entity = auditEntityLabel(input.entity);
  const id = input.entityId ? `（${input.entityId}）` : "";
  const action = auditActionLabel(input.action);
  if (input.action === "REDEMPTION_CREATED") {
    const amount = numberFrom(input.afterValue, "totalCost");
    return `${actor}提交了兑换订单${id}${amount === null ? "" : `，扣除 ${amount} 积分`}`;
  }
  if (input.action === "REDEMPTION_REJECTED" || input.action === "REDEMPTION_REFUNDED") {
    const amount = numberFrom(input.afterValue, "refunded");
    const target = stringFrom(input.afterValue, "targetNickname");
    const gift = stringFrom(input.afterValue, "giftName");
    return `${actor}${action}${target ? `${target}的` : ""}${gift ?? entity}${id}${amount === null ? "" : `，退回 ${amount} 积分`}`;
  }
  if (input.action === "REDEMPTION_FULFILLED") {
    const target = stringFrom(input.afterValue, "targetNickname");
    const gift = stringFrom(input.afterValue, "giftName");
    const kind = stringFrom(input.afterValue, "giftKind");
    return `${actor}将${target ? `${target}的` : ""}${gift ?? "兑换订单"}${id}标记为${kind === "CASH" ? "已发放" : "已发货"}`;
  }
  if (input.action === "REDEMPTION_TRACKING_UPDATED") {
    return `${actor}更新了兑换订单${id}的快递单号`;
  }
  if (input.action === "VIDEO_AUTO_REJECTED") {
    return `系统自动驳回视频${id}${input.reason ? `，原因：${input.reason}` : ""}`;
  }
  if (input.action === "LOGIN_FAILED") {
    const failure = stringFrom(input.afterValue, "reason");
    return `${actor}登录失败${failure ? `（${failure === "INVALID_PASSWORD" ? "密码错误" : failure === "UNKNOWN_ACCOUNT" ? "账号不存在" : "账号已停用"}）` : ""}`;
  }
  return `${actor}${action}${entity}${id}${input.reason ? `，原因：${input.reason}` : ""}`;
}

export function presentAuditLog(input: {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  reason: string | null;
  ip: string | null;
  requestId: string | null;
  createdAt: Date;
  actor: { kuaishouId: string; nickname: string; role: string } | null;
}) {
  return {
    ...input,
    actionLabel: auditActionLabel(input.action),
    entityLabel: auditEntityLabel(input.entity),
    summary: auditSummary(input),
    beforeValue: sanitizeValue(input.beforeValue),
    afterValue: sanitizeValue(input.afterValue),
  };
}
import { Prisma, PrismaClient } from "@prisma/client";

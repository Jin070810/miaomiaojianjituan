import { db } from "./db";
import { writeAuditLog } from "./audit";
import { initialiseMemberClearanceProgram, MEMBER_CLEARANCE_SWITCH } from "./member-clearance";

export const operationSwitchDefinitions = {
  VIDEO_SUBMISSIONS: {
    label: "视频提交",
    description: "关闭后，成员不能提交或重试视频，后台审核与历史查询不受影响。",
    disabledMessage: "视频提交当前暂停，请稍后再试",
    defaultEnabled: true,
  },
  POINT_TRANSFERS: {
    label: "积分转账",
    description: "关闭后，成员不能发起积分转账，已有积分流水不受影响。",
    disabledMessage: "积分转账当前暂停，请稍后再试",
    defaultEnabled: true,
  },
  REDEMPTIONS: {
    label: "礼品兑换",
    description: "关闭后，成员不能提交新兑换，管理员仍可处理已有订单。",
    disabledMessage: "礼品兑换当前暂停，请稍后再试",
    defaultEnabled: true,
  },
  WEEKLY_CHALLENGES: {
    label: "周挑战积分发放",
    description: "默认关闭。关闭后不激活新周期、不领取个人奖励，也不发放竞速奖励；历史任务仍可查询。",
    disabledMessage: "周挑战积分发放当前暂停，请稍后再试",
    defaultEnabled: false,
  },
  MEMBER_CLEARANCE: {
    label: "成员自动清退",
    description: "默认关闭。关闭时不发送预警或清退；重新开启后会立即处理已到期的普通成员。",
    disabledMessage: "成员自动清退当前暂停",
    defaultEnabled: false,
  },
  BIRTHDAY_PROGRAM: {
    label: "生日星愿",
    description: "关闭后隐藏生日墙并暂停生日资料、祝福和个人提醒，历史记录保留。",
    disabledMessage: "生日星愿暂未开放",
    defaultEnabled: false,
  },
  BIRTHDAY_REWARDS: {
    label: "生日奖励发放",
    description: "关闭后暂停生日抽奖和作品加成，生日墙与历史记录仍可查看。",
    disabledMessage: "生日奖励当前暂停",
    defaultEnabled: false,
  },
} as const;

export type OperationSwitchKey = keyof typeof operationSwitchDefinitions;

export async function getOperationSwitches() {
  const rows = await db.systemSetting.findMany({
    where: { key: { in: Object.keys(operationSwitchDefinitions) } },
    include: { updatedBy: { select: { nickname: true, kuaishouId: true } } },
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return Object.entries(operationSwitchDefinitions).map(([key, definition]) => {
    const row = byKey.get(key);
    return {
      key: key as OperationSwitchKey,
      label: definition.label,
      description: definition.description,
      enabled: row?.enabled ?? definition.defaultEnabled,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  });
}

export async function operationSwitchEnabled(key: OperationSwitchKey) {
  const row = await db.systemSetting.findUnique({ where: { key }, select: { enabled: true } });
  return row?.enabled ?? operationSwitchDefinitions[key].defaultEnabled;
}

export async function updateOperationSwitch(input: {
  key: OperationSwitchKey;
  enabled: boolean;
  actorId: string;
  ip?: string;
  requestId?: string;
}) {
  const updated = await db.$transaction(async (tx) => {
    const existing = await tx.systemSetting.findUnique({ where: { key: input.key } });
    if (existing?.enabled === input.enabled) return existing;
    const definition = operationSwitchDefinitions[input.key];
    const updated = await tx.systemSetting.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        enabled: input.enabled,
        description: definition.description,
        updatedById: input.actorId,
      },
      update: {
        enabled: input.enabled,
        description: definition.description,
        updatedById: input.actorId,
      },
    });
    await writeAuditLog(tx, {
      actorId: input.actorId,
      action: "OPERATION_SWITCH_UPDATED",
      entity: "SystemSetting",
      entityId: input.key,
      beforeValue: { enabled: existing?.enabled ?? definition.defaultEnabled },
      afterValue: { enabled: updated.enabled, label: definition.label },
      ip: input.ip,
      requestId: input.requestId,
    });
    return updated;
  });
  if (input.key === MEMBER_CLEARANCE_SWITCH && input.enabled) await initialiseMemberClearanceProgram();
  return updated;
}

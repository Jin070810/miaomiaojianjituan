import { db } from "./db";
import { writeAuditLog } from "./audit";

export const operationSwitchDefinitions = {
  VIDEO_SUBMISSIONS: {
    label: "视频提交",
    description: "关闭后，成员不能提交或重试视频，后台审核与历史查询不受影响。",
    disabledMessage: "视频提交当前暂停，请稍后再试",
  },
  POINT_TRANSFERS: {
    label: "积分转账",
    description: "关闭后，成员不能发起积分转账，已有积分流水不受影响。",
    disabledMessage: "积分转账当前暂停，请稍后再试",
  },
  REDEMPTIONS: {
    label: "礼品兑换",
    description: "关闭后，成员不能提交新兑换，管理员仍可处理已有订单。",
    disabledMessage: "礼品兑换当前暂停，请稍后再试",
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
      enabled: row?.enabled ?? true,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  });
}

export async function operationSwitchEnabled(key: OperationSwitchKey) {
  const row = await db.systemSetting.findUnique({ where: { key }, select: { enabled: true } });
  return row?.enabled ?? true;
}

export async function updateOperationSwitch(input: {
  key: OperationSwitchKey;
  enabled: boolean;
  actorId: string;
  ip?: string;
  requestId?: string;
}) {
  return db.$transaction(async (tx) => {
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
      beforeValue: { enabled: existing?.enabled ?? true },
      afterValue: { enabled: updated.enabled, label: definition.label },
      ip: input.ip,
      requestId: input.requestId,
    });
    return updated;
  });
}

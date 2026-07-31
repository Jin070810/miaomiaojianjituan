import { MemberEligibilityStatus, Prisma, PrismaClient, RejoinRequestStatus, Role } from "@prisma/client";
import { db } from "./db";
import { createNotification } from "./notifications";
import { writeAuditLog } from "./audit";

type Tx = Prisma.TransactionClient;

export const MEMBER_CLEARANCE_SWITCH = "MEMBER_CLEARANCE";
export const CLEARANCE_DEFAULTS = {
  inactivityDays: 30,
  warningDays: [7, 3],
  cooldownDays: 15,
} as const;
const REJOIN_RETRY_DAYS = 7;
const DAY = 86_400_000;

function plusDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY);
}

export function clearanceSchedule(start: Date, policy: { inactivityDays: number; warningDays: number[]; cooldownDays: number }) {
  const deadlineAt = plusDays(start, policy.inactivityDays);
  return {
    deadlineAt,
    warnings: [...policy.warningDays].sort((a, b) => b - a).map((daysRemaining) => ({ daysRemaining, at: plusDays(deadlineAt, -daysRemaining) })),
    cooldownEndsAt: plusDays(deadlineAt, policy.cooldownDays),
  };
}

function isEligibleMember(user: { active: boolean; role: Role | string }) {
  return user.active && user.role === "MEMBER";
}

async function activePolicy(tx: Tx) {
  const policy = await tx.membershipClearancePolicyVersion.findFirst({ orderBy: { version: "desc" } });
  if (policy) return policy;
  return tx.membershipClearancePolicyVersion.create({
    data: { version: 1, inactivityDays: CLEARANCE_DEFAULTS.inactivityDays, warningDays: [...CLEARANCE_DEFAULTS.warningDays], cooldownDays: CLEARANCE_DEFAULTS.cooldownDays },
  });
}

export function validateClearancePolicy(input: { inactivityDays: number; warningDays: number[]; cooldownDays: number }) {
  const warningDays = [...new Set(input.warningDays)].sort((a, b) => b - a);
  if (!Number.isInteger(input.inactivityDays) || input.inactivityDays < 1 || input.inactivityDays > 3650) throw new Error("无产出天数必须为 1 至 3650 的整数");
  if (warningDays.length !== 2 || warningDays.some((day) => !Number.isInteger(day) || day < 1 || day >= input.inactivityDays)) throw new Error("请设置两个早于清退日的整数预警天数");
  if (!Number.isInteger(input.cooldownDays) || input.cooldownDays < 1 || input.cooldownDays > 3650) throw new Error("冷却天数必须为 1 至 3650 的整数");
  return { inactivityDays: input.inactivityDays, warningDays, cooldownDays: input.cooldownDays };
}

export async function getClearancePolicy() {
  return db.$transaction((tx) => activePolicy(tx));
}

export async function createClearancePolicyVersion(input: {
  inactivityDays: number;
  warningDays: number[];
  cooldownDays: number;
  actorId: string;
  ip?: string;
  requestId?: string;
}) {
  const policy = validateClearancePolicy(input);
  return db.$transaction(async (tx) => {
    const previous = await activePolicy(tx);
    const created = await tx.membershipClearancePolicyVersion.create({
      data: { ...policy, version: previous.version + 1, createdById: input.actorId },
    });
    await writeAuditLog(tx, {
      actorId: input.actorId,
      action: "MEMBER_CLEARANCE_POLICY_CREATED",
      entity: "MembershipClearancePolicyVersion",
      entityId: created.id,
      beforeValue: { version: previous.version, inactivityDays: previous.inactivityDays, warningDays: previous.warningDays, cooldownDays: previous.cooldownDays },
      afterValue: { version: created.version, ...policy },
      ip: input.ip,
      requestId: input.requestId,
    });
    return created;
  });
}

async function clearanceEnabled(tx: Tx) {
  const setting = await tx.systemSetting.findUnique({ where: { key: MEMBER_CLEARANCE_SWITCH }, select: { enabled: true } });
  return setting?.enabled ?? false;
}

async function ensureProgram(tx: Tx, now: Date) {
  const program = await tx.memberClearanceProgram.upsert({
    where: { id: "default" },
    create: { id: "default", firstEnabledAt: now },
    update: {},
  });
  if (program.firstEnabledAt) return program;
  return tx.memberClearanceProgram.update({ where: { id: "default" }, data: { firstEnabledAt: now } });
}

export async function initialiseMemberClearanceProgram(now = new Date()) {
  return db.$transaction(async (tx) => {
    const policy = await activePolicy(tx);
    const program = await ensureProgram(tx, now);
    const users = await tx.user.findMany({
      where: { active: true, role: "MEMBER", eligibility: null },
      select: { id: true, createdAt: true },
    });
    if (users.length) {
      await tx.memberEligibility.createMany({
        data: users.map((user) => ({
          userId: user.id,
          policyVersionId: policy.id,
          cycleStartedAt: new Date(Math.max(user.createdAt.getTime(), (program.firstEnabledAt ?? now).getTime())),
        })),
        skipDuplicates: true,
      });
    }
    return { policy, initialized: users.length, firstEnabledAt: program.firstEnabledAt };
  });
}

export async function ensureNewMemberEligibility(tx: Tx, user: { id: string; createdAt: Date; role: Role; active: boolean }) {
  if (!isEligibleMember(user) || !(await clearanceEnabled(tx))) return null;
  const policy = await activePolicy(tx);
  return tx.memberEligibility.upsert({
    where: { userId: user.id },
    create: { userId: user.id, policyVersionId: policy.id, cycleStartedAt: user.createdAt },
    update: {},
  });
}

export async function syncEligibilityAfterRoleChange(tx: Tx, user: { id: string; role: Role; active: boolean; createdAt: Date }) {
  const current = await tx.memberEligibility.findUnique({ where: { userId: user.id } });
  if (user.role !== "MEMBER") {
    if (current) await tx.memberEligibility.update({ where: { id: current.id }, data: { status: "EXEMPT" } });
    return;
  }
  if (!user.active || !(await clearanceEnabled(tx))) return;
  const policy = await activePolicy(tx);
  if (!current) {
    await tx.memberEligibility.create({ data: { userId: user.id, policyVersionId: policy.id, cycleStartedAt: new Date() } });
  } else if (current.status === "EXEMPT") {
    await tx.memberEligibility.update({ where: { id: current.id }, data: { status: "ACTIVE", policyVersionId: policy.id, cycleStartedAt: new Date(), lastOutputAt: null, warning14SentAt: null, warning3SentAt: null } });
  }
}

/** Returns false when an approval must not revive a cleared account. */
export async function refreshEligibilityAfterApprovedVideo(tx: Tx, userId: string, approvedAt: Date) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, active: true, role: true, createdAt: true } });
  if (!user.active) return false;
  await tx.$queryRaw`SELECT "id" FROM "MemberEligibility" WHERE "userId" = ${userId} FOR UPDATE`;
  if (user.role !== "MEMBER") {
    const current = await tx.memberEligibility.findUnique({ where: { userId } });
    if (current) await tx.memberEligibility.update({ where: { id: current.id }, data: { status: "EXEMPT" } });
    return true;
  }
  if (!(await clearanceEnabled(tx))) return true;
  const current = await tx.memberEligibility.findUnique({ where: { userId } });
  if (current?.status === "COOLDOWN" || current?.status === "REJOIN_PENDING" || current?.status === "REJOIN_REJECTED") return false;
  const policy = await activePolicy(tx);
  await tx.memberEligibility.upsert({
    where: { userId },
    create: { userId, policyVersionId: policy.id, status: "ACTIVE", cycleStartedAt: approvedAt, lastOutputAt: approvedAt },
    update: {
      policyVersionId: policy.id,
      status: "ACTIVE",
      cycleStartedAt: approvedAt,
      lastOutputAt: approvedAt,
      warning14SentAt: null,
      warning3SentAt: null,
      clearedAt: null,
      cooldownEndsAt: null,
      rejoinRetryAt: null,
    },
  });
  return true;
}

async function clearMember(eligibilityId: string, now: Date) {
  return db.$transaction(async (tx) => {
    const candidate = await tx.memberEligibility.findUnique({ where: { id: eligibilityId }, select: { userId: true } });
    if (!candidate) return false;
    // Keep the same member → eligibility → account lock order as video approval.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "MemberEligibility" WHERE "id" = ${eligibilityId} FOR UPDATE`;
    const eligibility = await tx.memberEligibility.findUnique({
      where: { id: eligibilityId },
      include: { user: true, policyVersion: true },
    });
    if (!eligibility || eligibility.status !== "ACTIVE" || !isEligibleMember(eligibility.user)) return false;
    const base = eligibility.lastOutputAt ?? eligibility.cycleStartedAt;
    if (now < plusDays(base, eligibility.policyVersion.inactivityDays)) return false;

    await tx.$queryRaw`SELECT "id" FROM "PointAccount" WHERE "userId" = ${eligibility.userId} FOR UPDATE`;
    const account = await tx.pointAccount.upsert({ where: { userId: eligibility.userId }, create: { userId: eligibility.userId }, update: {} });
    const openOrders = await tx.redemptionOrder.findMany({
      where: { userId: eligibility.userId, status: { in: ["PENDING", "APPROVED"] } },
      select: { id: true, giftId: true, quantity: true, totalCost: true, status: true },
    });
    for (const order of openOrders) {
      const claimed = await tx.redemptionOrder.updateMany({
        where: { id: order.id, status: { in: ["PENDING", "APPROVED"] } },
        data: { status: "CLEARANCE_CANCELLED", reviewedAt: now, note: "成员自动清退取消" },
      });
      if (claimed.count !== 1) continue;
      await tx.gift.update({ where: { id: order.giftId }, data: { stock: { increment: order.quantity } } });
      const refunded = await tx.pointAccount.update({ where: { id: account.id }, data: { balance: { increment: order.totalCost }, version: { increment: 1 } } });
      await tx.pointLedger.create({ data: {
        accountId: account.id, type: "REDEMPTION_REFUND", amount: order.totalCost, balanceAfter: refunded.balance,
        referenceId: order.id, note: "成员自动清退取消订单并退回积分", idempotencyKey: `clearance-refund:${order.id}`,
      } });
    }
    const currentAccount = await tx.pointAccount.findUniqueOrThrow({ where: { id: account.id } });
    if (currentAccount.balance > 0) {
      const forfeited = await tx.pointAccount.update({ where: { id: account.id }, data: { balance: 0, version: { increment: 1 } } });
      await tx.pointLedger.create({ data: {
        accountId: account.id, type: "MEMBER_CLEARANCE_FORFEIT", amount: -currentAccount.balance, balanceAfter: forfeited.balance,
        referenceId: eligibility.id, note: "成员自动清退：积分清零", idempotencyKey: `clearance-forfeit:${eligibility.id}`,
      } });
    }
    const cooldownEndsAt = plusDays(now, eligibility.policyVersion.cooldownDays);
    await tx.videoSubmission.updateMany({
      where: { userId: eligibility.userId, status: { in: ["PROCESSING", "PENDING_REVIEW", "FAILED"] } },
      data: { status: "REJECTED", points: 0, reviewReason: "账号已因长期无有效产出被清退", processedAt: now, reviewedAt: now },
    });
    await tx.user.update({ where: { id: eligibility.userId }, data: { active: false } });
    await tx.session.deleteMany({ where: { userId: eligibility.userId } });
    await tx.memberEligibility.update({ where: { id: eligibility.id }, data: { status: "COOLDOWN", clearedAt: now, cooldownEndsAt } });
    await createNotification(tx, {
      userId: eligibility.userId, type: "MEMBER_CLEARANCE", title: "成员资格已清退",
      body: `连续 ${eligibility.policyVersion.inactivityDays} 天没有审核通过的视频，账号已清退；${cooldownEndsAt.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })} 后可申请重新加入。`,
      entityType: "MemberEligibility", entityId: eligibility.id, metadata: { cooldownEndsAt: cooldownEndsAt.toISOString() }, dedupeKey: `member-clearance:${eligibility.id}:cleared`,
    });
    await writeAuditLog(tx, {
      action: "MEMBER_AUTO_CLEARED", entity: "MemberEligibility", entityId: eligibility.id,
      beforeValue: { status: "ACTIVE", balance: currentAccount.balance, openOrders: openOrders.length },
      afterValue: { status: "COOLDOWN", balance: 0, cooldownEndsAt: cooldownEndsAt.toISOString(), cancelledOrders: openOrders.length },
      reason: `连续 ${eligibility.policyVersion.inactivityDays} 天无审核通过视频`,
    });
    return true;
  });
}

export async function runMemberClearanceMaintenance(now = new Date()) {
  if (!(await db.$transaction((tx) => clearanceEnabled(tx)))) return { initialized: 0, warned: 0, cleared: 0 };
  const initialized = await initialiseMemberClearanceProgram(now);
  const rows = await db.memberEligibility.findMany({
    where: { status: "ACTIVE", user: { active: true, role: "MEMBER" } },
    include: { policyVersion: true },
    orderBy: { cycleStartedAt: "asc" },
    take: 500,
  });
  let warned = 0;
  let cleared = 0;
  for (const row of rows) {
    const base = row.lastOutputAt ?? row.cycleStartedAt;
    const deadline = plusDays(base, row.policyVersion.inactivityDays);
    if (now >= deadline) {
      if (await clearMember(row.id, now)) cleared += 1;
      continue;
    }
    const warnings = [...row.policyVersion.warningDays].sort((a, b) => b - a);
    for (const warning of warnings) {
      const sentAt = warning === warnings[0] ? row.warning14SentAt : row.warning3SentAt;
      if (sentAt || now < plusDays(deadline, -warning)) continue;
      await db.$transaction(async (tx) => {
        const claimed = await tx.memberEligibility.updateMany({
          where: { id: row.id, ...(warning === warnings[0] ? { warning14SentAt: null } : { warning3SentAt: null }) },
          data: warning === warnings[0] ? { warning14SentAt: now } : { warning3SentAt: now },
        });
        if (claimed.count !== 1) return;
        await createNotification(tx, {
          userId: row.userId, type: "MEMBER_CLEARANCE", title: "成员资格即将到期",
          body: `再过 ${warning} 天仍没有审核通过的视频，账号将被自动清退。请尽快提交有效切片。`,
          entityType: "MemberEligibility", entityId: row.id, metadata: { daysRemaining: warning, deadline: deadline.toISOString() }, dedupeKey: `member-clearance:${row.id}:warning:${warning}`,
        });
      });
      warned += 1;
    }
  }
  return { initialized: initialized.initialized, warned, cleared };
}

export async function getLoginClearanceStatus(userId: string) {
  return db.memberEligibility.findUnique({
    where: { userId },
    select: { status: true, cooldownEndsAt: true, rejoinRetryAt: true },
  });
}

export async function requestRejoin(input: { userId: string; ip?: string; requestId?: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "MemberEligibility" WHERE "userId" = ${input.userId} FOR UPDATE`;
    const eligibility = await tx.memberEligibility.findUnique({ where: { userId: input.userId } });
    if (!eligibility || !["COOLDOWN", "REJOIN_REJECTED"].includes(eligibility.status)) throw new Error("当前账号不能申请重新加入");
    const now = new Date();
    const next = eligibility.status === "COOLDOWN" ? eligibility.cooldownEndsAt : eligibility.rejoinRetryAt;
    if (next && now < next) throw new Error(`暂未到申请时间，请于 ${next.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })} 后再试`);
    const request = await tx.rejoinRequest.create({ data: { eligibilityId: eligibility.id, userId: input.userId } });
    await tx.memberEligibility.update({ where: { id: eligibility.id }, data: { status: "REJOIN_PENDING" } });
    await writeAuditLog(tx, { action: "MEMBER_REJOIN_REQUESTED", entity: "RejoinRequest", entityId: request.id, afterValue: { userId: input.userId }, ip: input.ip, requestId: input.requestId });
    return request;
  });
}

export async function reviewRejoin(input: { requestId: string; reviewerId: string; approved: boolean; reason?: string; ip?: string; requestTraceId?: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "RejoinRequest" WHERE "id" = ${input.requestId} FOR UPDATE`;
    const request = await tx.rejoinRequest.findUnique({ where: { id: input.requestId }, include: { eligibility: true } });
    if (!request) throw new Error("重新加入申请不存在");
    if (request.status !== "PENDING") return request;
    const now = new Date();
    const reason = input.reason?.trim() || null;
    const reviewed = await tx.rejoinRequest.update({ where: { id: request.id }, data: { status: input.approved ? "APPROVED" : "REJECTED", reviewedAt: now, reviewedById: input.reviewerId, reviewReason: reason } });
    if (input.approved) {
      const policy = await activePolicy(tx);
      await tx.user.update({ where: { id: request.userId }, data: { active: true } });
      await tx.memberEligibility.update({ where: { id: request.eligibilityId }, data: { status: "ACTIVE", policyVersionId: policy.id, cycleStartedAt: now, lastOutputAt: null, warning14SentAt: null, warning3SentAt: null, cooldownEndsAt: null, rejoinRetryAt: null } });
    } else {
      await tx.memberEligibility.update({ where: { id: request.eligibilityId }, data: { status: "REJOIN_REJECTED", rejoinRetryAt: plusDays(now, REJOIN_RETRY_DAYS) } });
    }
    await writeAuditLog(tx, {
      actorId: input.reviewerId, action: input.approved ? "MEMBER_REJOIN_APPROVED" : "MEMBER_REJOIN_REJECTED", entity: "RejoinRequest", entityId: request.id,
      afterValue: { userId: request.userId, approved: input.approved, rejoinRetryAt: input.approved ? null : plusDays(now, REJOIN_RETRY_DAYS).toISOString() }, reason, ip: input.ip, requestId: input.requestTraceId,
    });
    return reviewed;
  });
}

export async function listMemberClearanceAdmin() {
  const [policy, program, eligibilities, requests] = await Promise.all([
    getClearancePolicy(),
    db.memberClearanceProgram.findUnique({ where: { id: "default" } }),
    db.memberEligibility.findMany({ include: { user: { select: { id: true, nickname: true, kuaishouId: true, active: true } }, policyVersion: true }, orderBy: { updatedAt: "desc" }, take: 200 }),
    db.rejoinRequest.findMany({ where: { status: "PENDING" }, include: { user: { select: { nickname: true, kuaishouId: true } } }, orderBy: { requestedAt: "asc" }, take: 100 }),
  ]);
  return { policy, program, eligibilities, requests };
}

export const memberClearanceInternals = { clearMember };

import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { createNotification } from "./notifications";
import { decryptSensitive, encryptSensitive } from "./security";
import { isMemberParticipantRole, memberParticipantRoles } from "./member-roles";
import { parseMembershipFields, validateMembershipAnswers } from "./gifts";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const PROFILE_EFFECT_DELAY_MS = 7 * DAY_MS;
const SELF_CHANGE_INTERVAL_MS = 365 * DAY_MS;
const DRAW_WINDOW_DAYS = 7;
const CLAIM_WINDOW_DAYS = 30;
const BONUS_RATE = 0.2;
const BONUS_CAP = 500;

export const BIRTHDAY_PROGRAM_SWITCH = "BIRTHDAY_PROGRAM" as const;
export const BIRTHDAY_REWARDS_SWITCH = "BIRTHDAY_REWARDS" as const;
export const BIRTHDAY_DRAW_POLICY_VERSION = "birthday-draw-v1";

export const BIRTHDAY_WISH_PRESETS = [
  { code: "HIGHLIGHTS", label: "高光常伴", message: "愿新一岁的你灵感常亮，高光不断。" },
  { code: "HAPPY", label: "快乐加倍", message: "愿今天的快乐，在新一岁里一直加倍。" },
  { code: "CREATIVE", label: "灵感满格", message: "愿你的每一次创作都有惊喜，灵感永远满格。" },
  { code: "WISHES", label: "心愿成真", message: "愿认真许下的心愿，都在新一岁里慢慢实现。" },
  { code: "BLOSSOM", label: "一路生花", message: "愿你一路有花、有光，也有并肩同行的伙伴。" },
  { code: "BLOCKBUSTER", label: "爆款常来", message: "祝你作品常出高光，数据一路长虹。" },
] as const;

export type BirthdayWishPresetCode = typeof BIRTHDAY_WISH_PRESETS[number]["code"];

export type BirthdayDrawBand =
  | { kind: "POINTS"; points: number }
  | { kind: "GIFT"; minimumCost: number; maximumCost: number; fallbackPoints: number };

export function birthdayDrawBand(ticket: number): BirthdayDrawBand {
  if (!Number.isInteger(ticket) || ticket < 0 || ticket > 99_999) throw new Error("抽奖票号无效");
  if (ticket < 12_000) return { kind: "POINTS", points: 10 };
  if (ticket < 26_000) return { kind: "POINTS", points: 20 };
  if (ticket < 46_000) return { kind: "POINTS", points: 50 };
  if (ticket < 68_000) return { kind: "POINTS", points: 100 };
  if (ticket < 84_000) return { kind: "POINTS", points: 200 };
  if (ticket < 91_000) return { kind: "POINTS", points: 500 };
  if (ticket < 92_000) return { kind: "POINTS", points: 1000 };
  if (ticket < 96_000) return { kind: "GIFT", minimumCost: 10, maximumCost: 199, fallbackPoints: 50 };
  if (ticket < 98_000) return { kind: "GIFT", minimumCost: 200, maximumCost: 499, fallbackPoints: 100 };
  if (ticket < 99_500) return { kind: "GIFT", minimumCost: 500, maximumCost: 999, fallbackPoints: 200 };
  return { kind: "GIFT", minimumCost: 1000, maximumCost: 2000, fallbackPoints: 500 };
}

export function shanghaiDateParts(value: Date) {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function shanghaiDayStart(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS);
}

export function birthdayOccurrence(year: number, month: number, day: number) {
  const effectiveDay = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
  return shanghaiDayStart(year, month, effectiveDay);
}

export function birthdayVideoBonus(basePoints: number, alreadyGranted: number) {
  if (!Number.isInteger(basePoints) || !Number.isInteger(alreadyGranted)) throw new Error("积分必须是整数");
  if (basePoints <= 0 || alreadyGranted >= BONUS_CAP) return 0;
  return Math.max(0, Math.min(Math.floor(basePoints * BONUS_RATE), BONUS_CAP - Math.max(0, alreadyGranted)));
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function validBirthdayDate(input: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new Error("生日日期格式不正确");
  const [year, month, day] = input.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() + 1 !== month || value.getUTCDate() !== day) {
    throw new Error("生日日期不存在");
  }
  const today = shanghaiDateParts(new Date());
  if (year < today.year - 120 || year > today.year || (year === today.year && (month > today.month || (month === today.month && day > today.day)))) {
    throw new Error("生日日期超出允许范围");
  }
  return { year, month, day, canonical: `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}` };
}

function switchDefault(key: string) {
  return key === BIRTHDAY_PROGRAM_SWITCH || key === BIRTHDAY_REWARDS_SWITCH ? false : true;
}

async function switchEnabled(key: string, tx: Prisma.TransactionClient | typeof db = db) {
  const row = await tx.systemSetting.findUnique({ where: { key }, select: { enabled: true } });
  return row?.enabled ?? switchDefault(key);
}

function effectiveProfileFields(profile: {
  birthDateEnc: string | null;
  birthMonth: number | null;
  birthDay: number | null;
  birthEffectiveAt: Date | null;
  pendingBirthDateEnc: string | null;
  pendingBirthMonth: number | null;
  pendingBirthDay: number | null;
  pendingEffectiveAt: Date | null;
}, at: Date) {
  if (profile.pendingEffectiveAt && profile.pendingEffectiveAt <= at && profile.pendingBirthDateEnc && profile.pendingBirthMonth && profile.pendingBirthDay) {
    return { birthDateEnc: profile.pendingBirthDateEnc, month: profile.pendingBirthMonth, day: profile.pendingBirthDay, effectiveAt: profile.pendingEffectiveAt };
  }
  if (!profile.birthDateEnc || !profile.birthMonth || !profile.birthDay || !profile.birthEffectiveAt) return null;
  return { birthDateEnc: profile.birthDateEnc, month: profile.birthMonth, day: profile.birthDay, effectiveAt: profile.birthEffectiveAt };
}

export async function birthdaySubmissionEligibility(userId: string, submittedAt = new Date()) {
  const [programEnabled, rewardsEnabled, user, profile] = await Promise.all([
    switchEnabled(BIRTHDAY_PROGRAM_SWITCH),
    switchEnabled(BIRTHDAY_REWARDS_SWITCH),
    db.user.findUnique({ where: { id: userId }, select: { active: true, role: true } }),
    db.memberBirthdayProfile.findUnique({ where: { userId } }),
  ]);
  if (!programEnabled || !rewardsEnabled || !user?.active || !isMemberParticipantRole(user.role) || !profile) return null;
  const effective = effectiveProfileFields(profile, submittedAt);
  if (!effective) return null;
  const parts = shanghaiDateParts(submittedAt);
  const occurrence = birthdayOccurrence(parts.year, effective.month, effective.day);
  if (effective.effectiveAt > occurrence) return null;
  if (occurrence.getTime() !== shanghaiDayStart(parts.year, parts.month, parts.day).getTime()) return null;
  return { benefitYear: parts.year, occurrenceDate: occurrence };
}

export async function updateMemberBirthday(input: {
  userId: string;
  birthday?: string;
  visibleOnWall?: boolean;
  actorId?: string;
  adminReason?: string;
  ip?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (!input.adminReason && !(await switchEnabled(BIRTHDAY_PROGRAM_SWITCH))) throw new Error("生日星愿暂未开放");
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { active: true, role: true } });
    if (!user || !user.active || !isMemberParticipantRole(user.role)) throw new Error("成员不存在或当前不能参加生日星愿");
    const existing = await tx.memberBirthdayProfile.findUnique({ where: { userId: input.userId } });
    const parsed = input.birthday ? validBirthdayDate(input.birthday) : null;
    const storedBirthday = existing?.pendingBirthDateEnc ?? existing?.birthDateEnc;
    const sameBirthday = Boolean(parsed && storedBirthday && decryptSensitive(storedBirthday) === parsed.canonical);
    if (parsed && !sameBirthday && !input.adminReason && existing?.lastSelfChangeAt && now.getTime() - existing.lastSelfChangeAt.getTime() < SELF_CHANGE_INTERVAL_MS) {
      throw new Error("生日资料每 365 天只能修改一次");
    }
    const effectiveAt = parsed && !sameBirthday ? new Date(now.getTime() + PROFILE_EFFECT_DELAY_MS) : null;
    const visible = input.visibleOnWall ?? existing?.visibleOnWall ?? false;
    const saved = await tx.memberBirthdayProfile.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        pendingBirthDateEnc: parsed ? encryptSensitive(parsed.canonical) : null,
        pendingBirthMonth: parsed?.month ?? null,
        pendingBirthDay: parsed?.day ?? null,
        pendingEffectiveAt: effectiveAt,
        visibleOnWall: visible,
        visibilityConsentedAt: visible ? now : null,
        lastSelfChangeAt: parsed && !input.adminReason ? now : null,
      },
      update: {
        ...(parsed && !sameBirthday ? {
          pendingBirthDateEnc: encryptSensitive(parsed.canonical),
          pendingBirthMonth: parsed.month,
          pendingBirthDay: parsed.day,
          pendingEffectiveAt: effectiveAt,
          ...(!input.adminReason ? { lastSelfChangeAt: now } : {}),
        } : {}),
        ...(input.visibleOnWall !== undefined ? {
          visibleOnWall: input.visibleOnWall,
          visibilityConsentedAt: input.visibleOnWall ? existing?.visibilityConsentedAt ?? now : null,
        } : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId ?? input.userId,
        action: input.adminReason ? "BIRTHDAY_PROFILE_ADMIN_CORRECTED" : "BIRTHDAY_PROFILE_UPDATED",
        entity: "MemberBirthdayProfile",
        entityId: saved.id,
        beforeValue: existing ? { birthMonth: existing.birthMonth, birthDay: existing.birthDay, visibleOnWall: existing.visibleOnWall } : undefined,
        afterValue: { pendingBirthMonth: sameBirthday ? undefined : parsed?.month, pendingBirthDay: sameBirthday ? undefined : parsed?.day, effectiveAt: effectiveAt?.toISOString(), visibleOnWall: saved.visibleOnWall },
        reason: input.adminReason,
        ip: input.ip,
      },
    });
    return saved;
  });
}

export async function markBirthdayOnboardingSeen(userId: string, now = new Date()) {
  if (!(await switchEnabled(BIRTHDAY_PROGRAM_SWITCH))) throw new Error("生日星愿暂未开放");
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
    if (!user?.active || !isMemberParticipantRole(user.role)) throw new Error("当前账号不能参加生日星愿");
    const existing = await tx.memberBirthdayProfile.findUnique({ where: { userId } });
    if (existing?.onboardingSeenAt) return existing;
    return tx.memberBirthdayProfile.upsert({
      where: { userId },
      create: { userId, onboardingSeenAt: now },
      update: { onboardingSeenAt: now },
    });
  });
}

export async function applyPendingBirthdayProfiles(now = new Date()) {
  const pending = await db.memberBirthdayProfile.findMany({
    where: { pendingEffectiveAt: { lte: now }, pendingBirthDateEnc: { not: null } },
    select: { id: true },
    take: 200,
  });
  let applied = 0;
  for (const row of pending) {
    const result = await db.$transaction(async (tx) => {
      const profile = await tx.memberBirthdayProfile.findUnique({ where: { id: row.id } });
      if (!profile?.pendingEffectiveAt || profile.pendingEffectiveAt > now || !profile.pendingBirthDateEnc || !profile.pendingBirthMonth || !profile.pendingBirthDay) return false;
      const changed = await tx.memberBirthdayProfile.updateMany({
        where: { id: profile.id, pendingEffectiveAt: { lte: now }, pendingBirthDateEnc: { not: null } },
        data: {
          birthDateEnc: profile.pendingBirthDateEnc,
          birthMonth: profile.pendingBirthMonth,
          birthDay: profile.pendingBirthDay,
          birthEffectiveAt: profile.pendingEffectiveAt,
          pendingBirthDateEnc: null,
          pendingBirthMonth: null,
          pendingBirthDay: null,
          pendingEffectiveAt: null,
        },
      });
      if (changed.count !== 1) return false;
      await tx.auditLog.create({ data: { action: "BIRTHDAY_PROFILE_EFFECTIVE", entity: "MemberBirthdayProfile", entityId: profile.id, afterValue: { birthMonth: profile.pendingBirthMonth, birthDay: profile.pendingBirthDay } } });
      return true;
    });
    if (result) applied += 1;
  }
  return applied;
}

async function ensureAnnualBenefit(tx: Prisma.TransactionClient, userId: string, year: number, month: number, day: number) {
  const occurrenceDate = birthdayOccurrence(year, month, day);
  return tx.birthdayAnnualBenefit.upsert({
    where: { userId_benefitYear: { userId, benefitYear: year } },
    create: {
      userId,
      benefitYear: year,
      occurrenceDate,
      drawOpensAt: occurrenceDate,
      drawClosesAt: new Date(occurrenceDate.getTime() + DRAW_WINDOW_DAYS * DAY_MS),
    },
    update: {},
  });
}

function occurrenceAround(profile: { month: number; day: number }, now: Date) {
  const parts = shanghaiDateParts(now);
  const candidates = [parts.year - 1, parts.year, parts.year + 1].map((year) => ({ year, at: birthdayOccurrence(year, profile.month, profile.day) }));
  return candidates;
}

export async function getBirthdayWall(viewerId: string, now = new Date()) {
  const [programEnabled, viewer] = await Promise.all([
    switchEnabled(BIRTHDAY_PROGRAM_SWITCH),
    db.user.findUnique({ where: { id: viewerId }, select: { active: true, role: true } }),
  ]);
  if (!programEnabled) throw new Error("生日星愿暂未开放");
  if (!viewer?.active || !isMemberParticipantRole(viewer.role)) throw new Error("当前账号不能查看生日墙");
  const rows = await db.memberBirthdayProfile.findMany({
    where: {
      visibleOnWall: true,
      OR: [
        { birthMonth: { not: null }, birthDay: { not: null }, birthEffectiveAt: { not: null } },
        { pendingEffectiveAt: { lte: now }, pendingBirthDateEnc: { not: null }, pendingBirthMonth: { not: null }, pendingBirthDay: { not: null } },
      ],
      user: { active: true, role: { in: memberParticipantRoles } },
    },
    include: { user: { select: { id: true, nickname: true, avatarUrl: true } } },
  });
  const today = shanghaiDateParts(now);
  const todayStart = shanghaiDayStart(today.year, today.month, today.day);
  const candidates = rows.flatMap((row) => {
    const effective = effectiveProfileFields(row, now);
    if (!effective) return [];
    const occurrences = occurrenceAround(effective, now);
    const closest = occurrences
      .map((item) => ({ ...item, deltaDays: Math.floor((item.at.getTime() - todayStart.getTime()) / DAY_MS) }))
      .filter((item) => item.at >= effective.effectiveAt)
      .filter((item) => item.deltaDays >= -7 && item.deltaDays <= 30)
      .sort((a, b) => Math.abs(a.deltaDays) - Math.abs(b.deltaDays))[0];
    return closest ? [{ profile: row, effective, ...closest }] : [];
  });
  const keys = candidates.map((item) => ({ recipientId: item.profile.user.id, benefitYear: item.year }));
  const wishes = keys.length ? await db.birthdayWish.findMany({
    where: { OR: keys.map((key) => ({ recipientId: key.recipientId, benefitYear: key.benefitYear })) },
    select: { recipientId: true, benefitYear: true, senderId: true, presetCode: true },
  }) : [];
  const serialized = candidates.map((item) => {
    const matching = wishes.filter((wish) => wish.recipientId === item.profile.user.id && wish.benefitYear === item.year);
    return {
      userId: item.profile.user.id,
      nickname: item.profile.user.nickname,
      avatarUrl: item.profile.user.avatarUrl,
      month: item.effective.month,
      day: item.effective.day,
      benefitYear: item.year,
      occurrenceDate: item.at,
      deltaDays: item.deltaDays,
      wishCount: matching.length,
      myWish: matching.find((wish) => wish.senderId === viewerId)?.presetCode ?? null,
      canWish: item.profile.user.id !== viewerId && item.deltaDays >= -7 && item.deltaDays <= 7,
    };
  }).sort((left, right) => left.deltaDays - right.deltaDays || left.nickname.localeCompare(right.nickname, "zh-CN"));
  return {
    today: serialized.filter((item) => item.deltaDays === 0),
    wishable: serialized.filter((item) => item.canWish),
    upcoming: serialized.filter((item) => item.deltaDays > 0),
    presets: BIRTHDAY_WISH_PRESETS,
  };
}

export async function sendBirthdayWish(input: { senderId: string; recipientId: string; benefitYear: number; presetCode: string; now?: Date; ip?: string }) {
  const now = input.now ?? new Date();
  if (input.senderId === input.recipientId) throw new Error("不能给自己送祝福");
  if (!BIRTHDAY_WISH_PRESETS.some((preset) => preset.code === input.presetCode)) throw new Error("祝福卡片不存在");
  if (!(await switchEnabled(BIRTHDAY_PROGRAM_SWITCH))) throw new Error("生日星愿暂未开放");
  return db.$transaction(async (tx) => {
    const [sender, recipient] = await Promise.all([
      tx.user.findUnique({ where: { id: input.senderId }, select: { active: true, role: true } }),
      tx.user.findUnique({ where: { id: input.recipientId }, include: { birthdayProfile: true } }),
    ]);
    if (!sender?.active || !isMemberParticipantRole(sender.role)) throw new Error("当前账号不能发送生日祝福");
    if (!recipient?.active || !isMemberParticipantRole(recipient.role) || !recipient.birthdayProfile?.visibleOnWall) {
      throw new Error("寿星不存在或未公开生日");
    }
    const effective = effectiveProfileFields(recipient.birthdayProfile, now);
    if (!effective) throw new Error("寿星生日资料尚未生效");
    const occurrence = birthdayOccurrence(input.benefitYear, effective.month, effective.day);
    if (effective.effectiveAt > occurrence) throw new Error("本年度生日发生时资料尚未生效");
    if (now < new Date(occurrence.getTime() - 7 * DAY_MS) || now >= new Date(occurrence.getTime() + 8 * DAY_MS)) throw new Error("当前不在祝福开放期");
    const existing = await tx.birthdayWish.findUnique({ where: { senderId_recipientId_benefitYear: { senderId: input.senderId, recipientId: input.recipientId, benefitYear: input.benefitYear } } });
    const wish = await tx.birthdayWish.upsert({
      where: { senderId_recipientId_benefitYear: { senderId: input.senderId, recipientId: input.recipientId, benefitYear: input.benefitYear } },
      create: { senderId: input.senderId, recipientId: input.recipientId, benefitYear: input.benefitYear, presetCode: input.presetCode },
      update: { presetCode: input.presetCode },
    });
    if (!existing) {
      await createNotification(tx, {
        userId: input.recipientId,
        type: "BIRTHDAY",
        title: "收到第一份生日祝福",
        body: "有团友送来了生日祝福，进入生日星愿查看吧。",
        entityType: "BirthdayAnnualBenefit",
        entityId: `${input.recipientId}:${input.benefitYear}`,
        dedupeKey: `birthday:first-wish:${input.recipientId}:${input.benefitYear}`,
      });
    }
    await tx.auditLog.create({ data: { actorId: input.senderId, action: existing ? "BIRTHDAY_WISH_UPDATED" : "BIRTHDAY_WISH_SENT", entity: "BirthdayWish", entityId: wish.id, afterValue: { recipientId: input.recipientId, benefitYear: input.benefitYear, presetCode: input.presetCode }, ip: input.ip } });
    return wish;
  });
}

async function creditBirthdayPoints(tx: Prisma.TransactionClient, input: { userId: string; amount: number; type: "BIRTHDAY_DRAW_REWARD" | "BIRTHDAY_VIDEO_BONUS"; referenceId: string; note: string; idempotencyKey: string }) {
  const existing = await tx.pointLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;
  const account = await tx.pointAccount.upsert({ where: { userId: input.userId }, create: { userId: input.userId }, update: {} });
  const updated = await tx.pointAccount.update({ where: { id: account.id }, data: { balance: { increment: input.amount }, version: { increment: 1 } } });
  return tx.pointLedger.create({ data: { accountId: account.id, amount: input.amount, balanceAfter: updated.balance, type: input.type, referenceId: input.referenceId, note: input.note, idempotencyKey: input.idempotencyKey } });
}

async function availableGiftForBand(tx: Prisma.TransactionClient, band: Extract<BirthdayDrawBand, { kind: "GIFT" }>) {
  const items = await tx.birthdayPrizePoolItem.findMany({
    where: { active: true, remainingStock: { gt: 0 }, gift: { active: true, deletedAt: null, kind: { in: ["PHYSICAL", "MEMBERSHIP"] }, pointsCost: { gte: band.minimumCost, lte: band.maximumCost } } },
    include: { gift: true },
    orderBy: { id: "asc" },
  });
  const total = items.reduce((sum, item) => sum + item.remainingStock, 0);
  if (total <= 0) return null;
  let unit = crypto.randomInt(total);
  for (const item of items) {
    if (unit < item.remainingStock) return item;
    unit -= item.remainingStock;
  }
  return null;
}

async function reserveGiftForBand(tx: Prisma.TransactionClient, band: Extract<BirthdayDrawBand, { kind: "GIFT" }>) {
  while (true) {
    const poolItem = await availableGiftForBand(tx, band);
    if (!poolItem) return null;
    const reserved = await tx.birthdayPrizePoolItem.updateMany({
      where: { id: poolItem.id, remainingStock: { gt: 0 } },
      data: { remainingStock: { decrement: 1 } },
    });
    if (reserved.count === 1) return poolItem;
  }
}

async function drawBirthdayPrizeOnce(input: { userId: string; idempotencyKey: string; now?: Date; ip?: string; ticket?: number }) {
  const now = input.now ?? new Date();
  if (!(await switchEnabled(BIRTHDAY_PROGRAM_SWITCH)) || !(await switchEnabled(BIRTHDAY_REWARDS_SWITCH))) throw new Error("生日奖励当前暂停");
  return db.$transaction(async (tx) => {
    const existingByKey = await tx.birthdayPrize.findUnique({ where: { drawIdempotencyKey: input.idempotencyKey }, include: { gift: true, annualBenefit: true } });
    if (existingByKey) {
      if (existingByKey.annualBenefit.userId !== input.userId) throw new Error("抽奖请求标识已被使用");
      return existingByKey;
    }
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { active: true, role: true } });
    if (!user?.active || !isMemberParticipantRole(user.role)) throw new Error("成员不存在或当前不能参加生日星愿");
    const profile = await tx.memberBirthdayProfile.findUnique({ where: { userId: input.userId } });
    if (!profile) throw new Error("请先登记生日");
    const effective = effectiveProfileFields(profile, now);
    if (!effective) throw new Error("生日资料尚未生效");
    const candidate = occurrenceAround(effective, now).find((item) => now >= item.at && now < new Date(item.at.getTime() + DRAW_WINDOW_DAYS * DAY_MS));
    if (!candidate) throw new Error("当前不在生日抽奖开放期");
    if (effective.effectiveAt > candidate.at) throw new Error("本年度生日发生时资料尚未生效，不补发生日权益");
    const benefit = await ensureAnnualBenefit(tx, input.userId, candidate.year, effective.month, effective.day);
    const existingPrize = await tx.birthdayPrize.findUnique({ where: { annualBenefitId: benefit.id }, include: { gift: true, annualBenefit: true } });
    if (existingPrize) return existingPrize;
    const ticket = input.ticket ?? crypto.randomInt(100_000);
    const band = birthdayDrawBand(ticket);
    const poolItem = band.kind === "GIFT" ? await reserveGiftForBand(tx, band) : null;
    if (poolItem) {
      const prize = await tx.birthdayPrize.create({ data: { annualBenefitId: benefit.id, kind: "GIFT", giftId: poolItem.giftId, poolItemId: poolItem.id, status: "PENDING_CLAIM", ticket, claimExpiresAt: new Date(now.getTime() + CLAIM_WINDOW_DAYS * DAY_MS), drawIdempotencyKey: input.idempotencyKey }, include: { gift: true, annualBenefit: true } });
      await tx.memberAchievement.upsert({ where: { userId_code: { userId: input.userId, code: "BIRTHDAY_STAR" } }, create: { userId: input.userId, code: "BIRTHDAY_STAR", metadata: { firstBenefitYear: candidate.year } }, update: {} });
      await createNotification(tx, { userId: input.userId, type: "BIRTHDAY", title: "生日礼物等待领奖", body: `抽中了“${poolItem.gift.name}”，请在 30 天内填写领奖资料。`, entityType: "BirthdayPrize", entityId: prize.id, dedupeKey: `birthday:claim-opened:${benefit.id}` });
      await tx.auditLog.create({ data: { actorId: input.userId, action: "BIRTHDAY_PRIZE_DRAWN", entity: "BirthdayPrize", entityId: prize.id, afterValue: { kind: "GIFT", giftId: poolItem.giftId, benefitYear: candidate.year, policyVersion: BIRTHDAY_DRAW_POLICY_VERSION }, ip: input.ip, requestId: input.idempotencyKey } });
      return prize;
    }
    const points = band.kind === "POINTS" ? band.points : band.fallbackPoints;
    const prize = await tx.birthdayPrize.create({ data: { annualBenefitId: benefit.id, kind: "POINTS", points, status: "GRANTED", ticket, fallback: band.kind === "GIFT", drawIdempotencyKey: input.idempotencyKey }, include: { gift: true, annualBenefit: true } });
    await creditBirthdayPoints(tx, { userId: input.userId, amount: points, type: "BIRTHDAY_DRAW_REWARD", referenceId: prize.id, note: "生日星愿抽奖奖励", idempotencyKey: `birthday-draw:${benefit.id}` });
    await tx.memberAchievement.upsert({ where: { userId_code: { userId: input.userId, code: "BIRTHDAY_STAR" } }, create: { userId: input.userId, code: "BIRTHDAY_STAR", metadata: { firstBenefitYear: candidate.year } }, update: {} });
    await tx.auditLog.create({ data: { actorId: input.userId, action: "BIRTHDAY_PRIZE_DRAWN", entity: "BirthdayPrize", entityId: prize.id, afterValue: { kind: "POINTS", points, fallback: band.kind === "GIFT", benefitYear: candidate.year, policyVersion: BIRTHDAY_DRAW_POLICY_VERSION }, ip: input.ip, requestId: input.idempotencyKey } });
    return prize;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function drawBirthdayPrize(input: { userId: string; idempotencyKey: string; now?: Date; ip?: string; ticket?: number }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await drawBirthdayPrizeOnce(input);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code)) throw error;
      const now = input.now ?? new Date();
      const existing = await db.birthdayPrize.findFirst({
        where: { annualBenefit: { userId: input.userId, drawOpensAt: { lte: now }, drawClosesAt: { gt: now } } },
        include: { gift: true, annualBenefit: true },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return existing;
      if (attempt === 2) throw error;
    }
  }
  throw new Error("生日抽奖暂时繁忙，请重试");
}

export async function applyBirthdayVideoBonus(tx: Prisma.TransactionClient, input: { userId: string; videoId: string; basePoints: number; benefitYear: number | null; occurrenceDate: Date | null }) {
  if (!input.benefitYear || !input.occurrenceDate || input.basePoints <= 0 || !(await switchEnabled(BIRTHDAY_REWARDS_SWITCH, tx))) return 0;
  const benefit = await tx.birthdayAnnualBenefit.upsert({
    where: { userId_benefitYear: { userId: input.userId, benefitYear: input.benefitYear } },
    create: { userId: input.userId, benefitYear: input.benefitYear, occurrenceDate: input.occurrenceDate, drawOpensAt: input.occurrenceDate, drawClosesAt: new Date(input.occurrenceDate.getTime() + DRAW_WINDOW_DAYS * DAY_MS) },
    update: {},
  });
  const [locked] = await tx.$queryRaw<Array<{ bonusGranted: number }>>(Prisma.sql`SELECT "bonusGranted" FROM "BirthdayAnnualBenefit" WHERE "id" = ${benefit.id} FOR UPDATE`);
  const bonus = birthdayVideoBonus(input.basePoints, locked?.bonusGranted ?? benefit.bonusGranted);
  if (bonus <= 0) return 0;
  await tx.birthdayAnnualBenefit.update({ where: { id: benefit.id }, data: { bonusGranted: { increment: bonus } } });
  await creditBirthdayPoints(tx, { userId: input.userId, amount: bonus, type: "BIRTHDAY_VIDEO_BONUS", referenceId: input.videoId, note: "生日当天作品积分加成", idempotencyKey: `birthday-video:${input.videoId}` });
  await tx.videoSubmission.update({ where: { id: input.videoId }, data: { birthdayBonusPoints: bonus } });
  await tx.auditLog.create({ data: { action: "BIRTHDAY_VIDEO_BONUS_GRANTED", entity: "VideoSubmission", entityId: input.videoId, afterValue: { benefitYear: input.benefitYear, basePoints: input.basePoints, bonus } } });
  return bonus;
}

export async function revokeBirthdayVideoBonus(tx: Prisma.TransactionClient, input: { userId: string; videoId: string; benefitYear: number | null; bonusPoints: number }) {
  if (!input.benefitYear || input.bonusPoints <= 0) return 0;
  const existing = await tx.pointLedger.findUnique({ where: { idempotencyKey: `birthday-video-reversal:${input.videoId}` } });
  if (existing) return -existing.amount;
  const benefit = await tx.birthdayAnnualBenefit.findUnique({ where: { userId_benefitYear: { userId: input.userId, benefitYear: input.benefitYear } } });
  if (benefit) {
    const [locked] = await tx.$queryRaw<Array<{ bonusGranted: number }>>(Prisma.sql`SELECT "bonusGranted" FROM "BirthdayAnnualBenefit" WHERE "id" = ${benefit.id} FOR UPDATE`);
    await tx.birthdayAnnualBenefit.update({ where: { id: benefit.id }, data: { bonusGranted: Math.max(0, (locked?.bonusGranted ?? benefit.bonusGranted) - input.bonusPoints) } });
  }
  const account = await tx.pointAccount.upsert({ where: { userId: input.userId }, create: { userId: input.userId }, update: {} });
  const updated = await tx.pointAccount.update({ where: { id: account.id }, data: { balance: { decrement: input.bonusPoints }, version: { increment: 1 } } });
  await tx.pointLedger.create({ data: { accountId: account.id, amount: -input.bonusPoints, balanceAfter: updated.balance, type: "REVERSAL", referenceId: input.videoId, note: "撤销生日作品积分加成", idempotencyKey: `birthday-video-reversal:${input.videoId}` } });
  await tx.videoSubmission.update({ where: { id: input.videoId }, data: { birthdayBonusPoints: 0 } });
  return input.bonusPoints;
}

export async function configureBirthdayPoolItem(input: { actorId: string; giftId: string; quantity: number; ip?: string }) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > 10_000) throw new Error("预留数量必须是 1 至 10000 的整数");
  return db.$transaction(async (tx) => {
    const gift = await tx.gift.findUnique({ where: { id: input.giftId } });
    if (!gift || !gift.active || gift.deletedAt || gift.kind === "CASH" || gift.pointsCost < 10 || gift.pointsCost > 2000) throw new Error("该商品不能加入生日奖池");
    const existing = await tx.birthdayPrizePoolItem.findUnique({ where: { giftId: gift.id } });
    const changed = await tx.gift.updateMany({ where: { id: gift.id, stock: { gte: input.quantity } }, data: { stock: { decrement: input.quantity } } });
    if (changed.count !== 1) throw new Error("商城库存不足，无法预留");
    const poolItem = await tx.birthdayPrizePoolItem.upsert({
      where: { giftId: gift.id },
      create: { giftId: gift.id, allocatedStock: input.quantity, remainingStock: input.quantity },
      update: { allocatedStock: { increment: input.quantity }, remainingStock: { increment: input.quantity }, active: true },
    });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "BIRTHDAY_POOL_STOCK_RESERVED", entity: "BirthdayPrizePoolItem", entityId: poolItem.id, beforeValue: { giftStock: gift.stock, remainingStock: existing?.remainingStock ?? 0 }, afterValue: { giftStock: gift.stock - input.quantity, remainingStock: poolItem.remainingStock }, ip: input.ip } });
    return poolItem;
  });
}

export async function releaseBirthdayPoolItem(input: { actorId: string; poolItemId: string; quantity: number; ip?: string }) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new Error("释放数量必须是正整数");
  return db.$transaction(async (tx) => {
    const item = await tx.birthdayPrizePoolItem.findUnique({ where: { id: input.poolItemId } });
    if (!item || item.remainingStock < input.quantity) throw new Error("可释放的预留库存不足");
    const changed = await tx.birthdayPrizePoolItem.updateMany({ where: { id: item.id, remainingStock: { gte: input.quantity }, allocatedStock: { gte: input.quantity } }, data: { remainingStock: { decrement: input.quantity }, allocatedStock: { decrement: input.quantity } } });
    if (changed.count !== 1) throw new Error("可释放的预留库存已变化，请刷新后重试");
    const updated = await tx.birthdayPrizePoolItem.findUniqueOrThrow({ where: { id: item.id } });
    await tx.gift.update({ where: { id: item.giftId }, data: { stock: { increment: input.quantity } } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "BIRTHDAY_POOL_STOCK_RELEASED", entity: "BirthdayPrizePoolItem", entityId: item.id, beforeValue: { remainingStock: item.remainingStock }, afterValue: { remainingStock: updated.remainingStock, released: input.quantity }, ip: input.ip } });
    return updated;
  });
}

export async function revokeBirthdayPrize(input: { actorId: string; prizeId: string; reason: string; ip?: string; now?: Date }) {
  const now = input.now ?? new Date();
  if (input.reason.trim().length < 2 || input.reason.trim().length > 500) throw new Error("请填写 2 至 500 字的撤回原因");
  return db.$transaction(async (tx) => {
    const prize = await tx.birthdayPrize.findUnique({ where: { id: input.prizeId }, include: { redemptionOrder: true } });
    if (!prize || prize.kind !== "GIFT" || prize.status !== "PENDING_CLAIM" || !prize.giftId || prize.redemptionOrder) throw new Error("只有尚未领奖的生日商品可以撤回");
    const changed = await tx.birthdayPrize.updateMany({ where: { id: prize.id, status: "PENDING_CLAIM" }, data: { status: "REVOKED", revokedAt: now } });
    if (changed.count !== 1) throw new Error("奖品状态已变化，请刷新后重试");
    await tx.gift.update({ where: { id: prize.giftId }, data: { stock: { increment: 1 } } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "BIRTHDAY_GIFT_REVOKED", entity: "BirthdayPrize", entityId: prize.id, beforeValue: { status: prize.status }, afterValue: { status: "REVOKED", returnedToGiftStock: true }, reason: input.reason.trim(), ip: input.ip } });
    return tx.birthdayPrize.findUniqueOrThrow({ where: { id: prize.id } });
  });
}

export async function extendBirthdayWindow(input: { actorId: string; target: "DRAW" | "CLAIM"; id: string; days: number; reason: string; ip?: string }) {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 30) throw new Error("延长天数必须是 1 至 30 的整数");
  if (input.reason.trim().length < 2 || input.reason.trim().length > 500) throw new Error("请填写 2 至 500 字的延长原因");
  const extensionMs = input.days * DAY_MS;
  return db.$transaction(async (tx) => {
    if (input.target === "DRAW") {
      const benefit = await tx.birthdayAnnualBenefit.findUnique({ where: { id: input.id }, include: { prize: true } });
      if (!benefit) throw new Error("生日年度权益不存在");
      if (benefit.prize) throw new Error("已经抽奖的权益不能延长抽奖窗口");
      const updated = await tx.birthdayAnnualBenefit.update({ where: { id: benefit.id }, data: { drawClosesAt: new Date(benefit.drawClosesAt.getTime() + extensionMs) } });
      await tx.auditLog.create({ data: { actorId: input.actorId, action: "BIRTHDAY_DRAW_WINDOW_EXTENDED", entity: "BirthdayAnnualBenefit", entityId: benefit.id, beforeValue: { drawClosesAt: benefit.drawClosesAt.toISOString() }, afterValue: { drawClosesAt: updated.drawClosesAt.toISOString(), days: input.days }, reason: input.reason.trim(), ip: input.ip } });
      return updated;
    }
    const prize = await tx.birthdayPrize.findUnique({ where: { id: input.id } });
    if (!prize || prize.kind !== "GIFT" || prize.status !== "PENDING_CLAIM" || !prize.claimExpiresAt) throw new Error("待领奖生日商品不存在");
    const updated = await tx.birthdayPrize.update({ where: { id: prize.id }, data: { claimExpiresAt: new Date(prize.claimExpiresAt.getTime() + extensionMs) } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "BIRTHDAY_CLAIM_WINDOW_EXTENDED", entity: "BirthdayPrize", entityId: prize.id, beforeValue: { claimExpiresAt: prize.claimExpiresAt.toISOString() }, afterValue: { claimExpiresAt: updated.claimExpiresAt?.toISOString(), days: input.days }, reason: input.reason.trim(), ip: input.ip } });
    return updated;
  });
}

export async function claimBirthdayGift(input: { userId: string; prizeId: string; idempotencyKey: string; recipientName?: string; phone?: string; address?: string; membershipAnswers?: Record<string, string>; now?: Date; ip?: string }) {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const existingByKey = await tx.redemptionOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existingByKey) {
      if (existingByKey.userId !== input.userId || existingByKey.birthdayPrizeId !== input.prizeId) throw new Error("领奖请求标识已被使用");
      return existingByKey;
    }
    const [user, prize] = await Promise.all([
      tx.user.findUnique({ where: { id: input.userId }, select: { active: true, role: true } }),
      tx.birthdayPrize.findFirst({ where: { id: input.prizeId, annualBenefit: { userId: input.userId } }, include: { gift: true, redemptionOrder: true } }),
    ]);
    if (!user?.active || !isMemberParticipantRole(user.role)) throw new Error("当前账号不能领取生日礼物");
    if (!prize || prize.kind !== "GIFT" || !prize.gift) throw new Error("生日商品奖品不存在");
    if (prize.redemptionOrder) return prize.redemptionOrder;
    if (prize.status !== "PENDING_CLAIM" || !prize.claimExpiresAt || prize.claimExpiresAt <= now) throw new Error("生日商品领奖期限已结束");
    const gift = prize.gift;
    let recipientName: string | null = null;
    let phone: string | null = null;
    let address: string | null = null;
    let fulfillmentDataEnc: string | null = null;
    if (gift.kind === "PHYSICAL") {
      recipientName = input.recipientName?.trim() || null;
      phone = input.phone?.trim() || null;
      address = input.address?.trim() || null;
      if (!recipientName || !/^1\d{10}$/.test(phone ?? "") || !address) throw new Error("请填写完整的收货姓名、手机号和地址");
    } else if (gift.kind === "MEMBERSHIP") {
      const fields = parseMembershipFields(gift.fulfillmentFields);
      const answers = validateMembershipAnswers(fields, input.membershipAnswers ?? {});
      fulfillmentDataEnc = encryptSensitive(JSON.stringify({ fields, answers }));
    }
    const claimed = await tx.birthdayPrize.updateMany({
      where: { id: prize.id, status: "PENDING_CLAIM", claimExpiresAt: { gt: now } },
      data: { status: "CLAIMED", claimedAt: now },
    });
    if (claimed.count !== 1) {
      const existingOrder = await tx.redemptionOrder.findUnique({ where: { birthdayPrizeId: prize.id } });
      if (existingOrder) return existingOrder;
      throw new Error("生日商品领奖状态已变化，请刷新后重试");
    }
    const order = await tx.redemptionOrder.create({ data: { userId: input.userId, giftId: gift.id, quantity: 1, unitCost: 0, totalCost: 0, status: "PENDING", recipientName, recipientPhoneEnc: phone ? encryptSensitive(phone) : null, recipientAddressEnc: address ? encryptSensitive(address) : null, fulfillmentDataEnc, note: "生日星愿商品奖品", idempotencyKey: input.idempotencyKey, birthdayPrizeId: prize.id } });
    if (gift.kind === "PHYSICAL") {
      await tx.recipientProfile.upsert({ where: { userId: input.userId }, create: { userId: input.userId, recipientName, phoneEnc: encryptSensitive(phone!), addressEnc: encryptSensitive(address!) }, update: { recipientName, phoneEnc: encryptSensitive(phone!), addressEnc: encryptSensitive(address!) } });
    }
    await tx.auditLog.create({ data: { actorId: input.userId, action: "BIRTHDAY_GIFT_CLAIMED", entity: "BirthdayPrize", entityId: prize.id, afterValue: { giftId: gift.id, orderId: order.id }, ip: input.ip, requestId: input.idempotencyKey } });
    return order;
  });
}

export async function runBirthdayMaintenance(now = new Date()) {
  if (!(await switchEnabled(BIRTHDAY_PROGRAM_SWITCH))) return { appliedProfiles: 0, opened: 0, expired: 0 };
  const appliedProfiles = await applyPendingBirthdayProfiles(now);
  const rewardsEnabled = await switchEnabled(BIRTHDAY_REWARDS_SWITCH);
  const parts = shanghaiDateParts(now);
  const isNonLeapFebruary28 = parts.month === 2 && parts.day === 28 && !isLeapYear(parts.year);
  const occurrenceStart = shanghaiDayStart(parts.year, parts.month, parts.day);
  const profiles = await db.memberBirthdayProfile.findMany({
    where: {
      OR: [
        { birthMonth: parts.month, birthDay: parts.day },
        ...(isNonLeapFebruary28 ? [{ birthMonth: 2, birthDay: 29 }] : []),
      ],
      birthEffectiveAt: { lte: occurrenceStart },
      user: { active: true, role: { in: memberParticipantRoles } },
    },
    select: { userId: true, birthMonth: true, birthDay: true },
  });
  let opened = 0;
  for (const profile of profiles) {
    const benefit = await db.$transaction((tx) => ensureAnnualBenefit(tx, profile.userId, parts.year, profile.birthMonth!, profile.birthDay!));
    if (rewardsEnabled) {
      await db.$transaction(async (tx) => {
        await createNotification(tx, { userId: profile.userId, type: "BIRTHDAY", title: "生日星愿已开启", body: "生日快乐！你的年度生日抽奖已开启，7 天内可以参与。", entityType: "BirthdayAnnualBenefit", entityId: benefit.id, dedupeKey: `birthday:opened:${benefit.id}` });
      });
    }
    opened += 1;
  }
  const undrawn = rewardsEnabled ? await db.birthdayAnnualBenefit.findMany({ where: { drawClosesAt: { gt: now, lte: new Date(now.getTime() + DAY_MS) }, prize: null }, select: { id: true, userId: true } }) : [];
  for (const benefit of undrawn) {
    await db.$transaction((tx) => createNotification(tx, { userId: benefit.userId, type: "BIRTHDAY", title: "生日星愿即将结束", body: "你的年度生日抽奖将在 24 小时内结束，记得来开启。", entityType: "BirthdayAnnualBenefit", entityId: benefit.id, dedupeKey: `birthday:draw-reminder:${benefit.id}` }));
  }
  const pendingClaims = await db.birthdayPrize.findMany({ where: { status: "PENDING_CLAIM", claimExpiresAt: { gt: now } }, include: { annualBenefit: { select: { userId: true } }, gift: { select: { name: true } } } });
  for (const prize of pendingClaims) {
    const remainingDays = Math.ceil((prize.claimExpiresAt!.getTime() - now.getTime()) / DAY_MS);
    const reminderDay = remainingDays <= 7 ? 23 : remainingDays <= 23 ? 7 : null;
    if (!reminderDay) continue;
    await db.$transaction((tx) => createNotification(tx, { userId: prize.annualBenefit.userId, type: "BIRTHDAY", title: "生日礼物等待领奖", body: `“${prize.gift?.name ?? "生日礼物"}”还没有填写领奖资料，剩余 ${remainingDays} 天。`, entityType: "BirthdayPrize", entityId: prize.id, dedupeKey: `birthday:claim-reminder:${prize.id}:${reminderDay}` }));
  }
  const expiring = await db.birthdayPrize.findMany({ where: { status: "PENDING_CLAIM", claimExpiresAt: { lte: now } }, select: { id: true, giftId: true }, take: 200 });
  let expired = 0;
  for (const prize of expiring) {
    const changed = await db.$transaction(async (tx) => {
      const claimed = await tx.birthdayPrize.updateMany({ where: { id: prize.id, status: "PENDING_CLAIM", claimExpiresAt: { lte: now } }, data: { status: "EXPIRED", expiredAt: now } });
      if (claimed.count !== 1) return false;
      if (prize.giftId) await tx.gift.update({ where: { id: prize.giftId }, data: { stock: { increment: 1 } } });
      await tx.auditLog.create({ data: { action: "BIRTHDAY_GIFT_EXPIRED", entity: "BirthdayPrize", entityId: prize.id, afterValue: { returnedToGiftStock: Boolean(prize.giftId) } } });
      return true;
    });
    if (changed) expired += 1;
  }
  return { appliedProfiles, opened, expired };
}

export async function birthdayAdminSummary(now = new Date()) {
  const parts = shanghaiDateParts(now);
  const todayStart = shanghaiDayStart(parts.year, parts.month, parts.day);
  const [activeMembers, profileRows, benefits, prizes, pool, pendingClaims, drawWindows] = await Promise.all([
    db.user.count({ where: { active: true, role: { in: memberParticipantRoles } } }),
    db.memberBirthdayProfile.findMany({
      where: { user: { active: true, role: { in: memberParticipantRoles } } },
      select: { userId: true, birthMonth: true, birthDay: true, birthEffectiveAt: true, pendingBirthMonth: true, pendingBirthDay: true, pendingEffectiveAt: true, visibleOnWall: true, user: { select: { nickname: true } } },
    }),
    db.birthdayAnnualBenefit.findMany({ where: { benefitYear: parts.year }, include: { prize: true } }),
    db.birthdayPrize.groupBy({ where: { annualBenefit: { benefitYear: parts.year } }, by: ["kind", "status"], _count: { id: true }, _sum: { points: true } }),
    db.birthdayPrizePoolItem.findMany({ include: { gift: { select: { id: true, name: true, kind: true, pointsCost: true, stock: true, active: true } } }, orderBy: { createdAt: "desc" } }),
    db.birthdayPrize.findMany({ where: { status: "PENDING_CLAIM" }, include: { gift: { select: { name: true, kind: true } }, annualBenefit: { include: { user: { select: { nickname: true } } } } }, orderBy: { claimExpiresAt: "asc" }, take: 50 }),
    db.birthdayAnnualBenefit.findMany({ where: { prize: null, drawClosesAt: { gt: now } }, include: { user: { select: { nickname: true } } }, orderBy: { drawClosesAt: "asc" }, take: 50 }),
  ]);
  const upcoming = profileRows.flatMap((profile) => {
    if (!profile.birthMonth || !profile.birthDay || !profile.birthEffectiveAt) return [];
    const occurrence = occurrenceAround({ month: profile.birthMonth, day: profile.birthDay }, now)
      .map((item) => ({ ...item, deltaDays: Math.floor((item.at.getTime() - todayStart.getTime()) / DAY_MS) }))
      .filter((item) => item.deltaDays >= 0 && item.deltaDays <= 30 && item.at >= profile.birthEffectiveAt!)
      .sort((left, right) => left.deltaDays - right.deltaDays)[0];
    return occurrence ? [{ userId: profile.userId, nickname: profile.user.nickname, month: profile.birthMonth, day: profile.birthDay, deltaDays: occurrence.deltaDays }] : [];
  }).sort((left, right) => left.deltaDays - right.deltaDays || left.nickname.localeCompare(right.nickname, "zh-CN"));
  return {
    metrics: {
      activeMembers,
      profiles: profileRows.filter((profile) => Boolean(profile.birthMonth || profile.pendingEffectiveAt)).length,
      publicProfiles: profileRows.filter((profile) => profile.visibleOnWall && Boolean(profile.birthMonth)).length,
      benefits: benefits.length,
      bonusPoints: benefits.reduce((sum, item) => sum + item.bonusGranted, 0),
      drawPoints: benefits.reduce((sum, item) => sum + (item.prize?.points ?? 0), 0),
    },
    prizeGroups: prizes,
    pool,
    upcoming,
    profiles: profileRows.map((profile) => ({ userId: profile.userId, nickname: profile.user.nickname, birthMonth: profile.birthMonth, birthDay: profile.birthDay, pendingBirthMonth: profile.pendingBirthMonth, pendingBirthDay: profile.pendingBirthDay, pendingEffectiveAt: profile.pendingEffectiveAt, visibleOnWall: profile.visibleOnWall })),
    pendingClaims: pendingClaims.map((prize) => ({ id: prize.id, nickname: prize.annualBenefit.user.nickname, giftName: prize.gift?.name ?? "生日商品", giftKind: prize.gift?.kind, claimExpiresAt: prize.claimExpiresAt })),
    drawWindows: drawWindows.map((benefit) => ({ id: benefit.id, nickname: benefit.user.nickname, benefitYear: benefit.benefitYear, drawClosesAt: benefit.drawClosesAt })),
  };
}

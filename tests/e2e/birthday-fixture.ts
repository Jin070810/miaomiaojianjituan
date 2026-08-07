import argon2 from "argon2";
import { db } from "@/lib/db";
import { encryptSensitive } from "@/lib/security";
import { birthdayOccurrence, shanghaiDateParts } from "@/lib/birthdays";

export const birthdayE2EPassword = "BirthdayE2E-2026";
export const birthdayE2EIds = {
  member: "birthday-e2e-member",
  birthdayFriend: "birthday-e2e-friend",
  privateFriend: "birthday-e2e-private",
  admin: "birthday-e2e-admin",
};

export async function seedBirthdayE2E(reference = new Date()) {
  if (!process.env.DATABASE_URL?.includes("schema=")) throw new Error("生日 E2E 必须使用显式指定 schema 的测试数据库");
  await cleanupBirthdayE2E();
  const passwordHash = await argon2.hash(birthdayE2EPassword);
  const [member, birthdayFriend, privateFriend, admin] = await Promise.all([
    db.user.create({ data: { kuaishouId: birthdayE2EIds.member, nickname: "生日墙测试成员", passwordHash, role: "MEMBER", active: true, account: { create: { balance: 1_000 } } } }),
    db.user.create({ data: { kuaishouId: birthdayE2EIds.birthdayFriend, nickname: "今日公开寿星", passwordHash, role: "MEMBER", active: true, account: { create: { balance: 0 } } } }),
    db.user.create({ data: { kuaishouId: birthdayE2EIds.privateFriend, nickname: "今日隐藏寿星", passwordHash, role: "MEMBER", active: true, account: { create: { balance: 0 } } } }),
    db.user.create({ data: { kuaishouId: birthdayE2EIds.admin, nickname: "生日运营管理员", passwordHash, role: "ADMIN", active: true, account: { create: { balance: 0 } } } }),
  ]);
  const today = shanghaiDateParts(reference);
  const occurrence = birthdayOccurrence(today.year, today.month, today.day);
  const effectiveAt = new Date(occurrence.getTime() - 30 * 86_400_000);
  await db.memberBirthdayProfile.createMany({ data: [
    { userId: member.id, birthDateEnc: encryptSensitive(`1998-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`), birthMonth: today.month, birthDay: today.day, birthEffectiveAt: effectiveAt, visibleOnWall: false },
    { userId: birthdayFriend.id, birthDateEnc: encryptSensitive(`1999-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`), birthMonth: today.month, birthDay: today.day, birthEffectiveAt: effectiveAt, visibleOnWall: true, visibilityConsentedAt: effectiveAt },
    { userId: privateFriend.id, birthDateEnc: encryptSensitive(`2000-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`), birthMonth: today.month, birthDay: today.day, birthEffectiveAt: effectiveAt, visibleOnWall: false },
  ] });
  await db.birthdayAnnualBenefit.create({ data: { userId: member.id, benefitYear: today.year, occurrenceDate: occurrence, drawOpensAt: occurrence, drawClosesAt: new Date(occurrence.getTime() + 7 * 86_400_000) } });
  await Promise.all(["BIRTHDAY_PROGRAM", "BIRTHDAY_REWARDS"].map((key) => db.systemSetting.upsert({ where: { key }, create: { key, enabled: true }, update: { enabled: true, updatedById: null } })));
  return { member, birthdayFriend, privateFriend, admin };
}

export async function cleanupBirthdayE2E() {
  const users = await db.user.findMany({ where: { kuaishouId: { in: Object.values(birthdayE2EIds) } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  if (!userIds.length) return;
  await db.redemptionOrder.deleteMany({ where: { userId: { in: userIds } } });
  await db.notification.deleteMany({ where: { userId: { in: userIds } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await db.birthdayWish.deleteMany({ where: { OR: [{ senderId: { in: userIds } }, { recipientId: { in: userIds } }] } });
  await db.birthdayPrize.deleteMany({ where: { annualBenefit: { userId: { in: userIds } } } });
  await db.birthdayAnnualBenefit.deleteMany({ where: { userId: { in: userIds } } });
  await db.memberBirthdayProfile.deleteMany({ where: { userId: { in: userIds } } });
  await db.session.deleteMany({ where: { userId: { in: userIds } } });
  const accounts = await db.pointAccount.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  await db.pointLedger.deleteMany({ where: { accountId: { in: accounts.map((account) => account.id) } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
}

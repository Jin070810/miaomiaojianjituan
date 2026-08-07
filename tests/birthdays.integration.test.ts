import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  applyPendingBirthdayProfiles,
  claimBirthdayGift,
  configureBirthdayPoolItem,
  drawBirthdayPrize,
  extendBirthdayWindow,
  getBirthdayWall,
  revokeBirthdayPrize,
  runBirthdayMaintenance,
  sendBirthdayWish,
  updateMemberBirthday,
} from "@/lib/birthdays";
import { creditVideoReward, revokeVideoReward } from "@/lib/points";
import { encryptSensitive } from "@/lib/security";

const enabled = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("birthday database integration", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const now = new Date("2026-08-07T04:00:00.000Z");
  const occurrence = new Date("2026-08-06T16:00:00.000Z");
  const userIds: string[] = [];
  let birthdayMemberId = "";
  let senderId = "";
  let privateMemberId = "";
  let adminId = "";
  let productMemberAId = "";
  let productMemberBId = "";
  let expiringMemberId = "";
  let profileMemberId = "";
  let bonusMemberId = "";
  let missedMemberId = "";
  let revokedMemberId = "";
  const giftIds: string[] = [];
  const previousSettings = new Map<string, { enabled: boolean; description: string | null; updatedById: string | null } | null>();

  beforeAll(async () => {
    for (const key of ["BIRTHDAY_PROGRAM", "BIRTHDAY_REWARDS"]) {
      previousSettings.set(key, await db.systemSetting.findUnique({ where: { key }, select: { enabled: true, description: true, updatedById: true } }));
      await db.systemSetting.upsert({ where: { key }, create: { key, enabled: true }, update: { enabled: true } });
    }
    const users = await Promise.all([
      db.user.create({ data: { kuaishouId: `birthday-member-${suffix}`, nickname: "生日成员", passwordHash: "test", account: { create: { balance: 0 } } } }),
      db.user.create({ data: { kuaishouId: `birthday-sender-${suffix}`, nickname: "祝福成员", passwordHash: "test", account: { create: { balance: 1000 } } } }),
      db.user.create({ data: { kuaishouId: `birthday-private-${suffix}`, nickname: "隐藏生日", passwordHash: "test" } }),
      db.user.create({ data: { kuaishouId: `birthday-admin-${suffix}`, nickname: "生日管理员", passwordHash: "test", role: "ADMIN" } }),
      db.user.create({ data: { kuaishouId: `birthday-product-a-${suffix}`, nickname: "商品成员甲", passwordHash: "test", account: { create: { balance: 0 } } } }),
      db.user.create({ data: { kuaishouId: `birthday-product-b-${suffix}`, nickname: "商品成员乙", passwordHash: "test", account: { create: { balance: 0 } } } }),
      db.user.create({ data: { kuaishouId: `birthday-expiring-${suffix}`, nickname: "逾期成员", passwordHash: "test", account: { create: { balance: 0 } } } }),
      db.user.create({ data: { kuaishouId: `birthday-profile-${suffix}`, nickname: "资料成员", passwordHash: "test" } }),
      db.user.create({ data: { kuaishouId: `birthday-bonus-${suffix}`, nickname: "加成成员", passwordHash: "test", account: { create: { balance: 0 } } } }),
      db.user.create({ data: { kuaishouId: `birthday-missed-${suffix}`, nickname: "错过生日成员", passwordHash: "test", account: { create: { balance: 0 } } } }),
      db.user.create({ data: { kuaishouId: `birthday-revoked-${suffix}`, nickname: "撤回成员", passwordHash: "test", account: { create: { balance: 0 } } } }),
    ]);
    userIds.push(...users.map((user) => user.id));
    [birthdayMemberId, senderId, privateMemberId, adminId, productMemberAId, productMemberBId, expiringMemberId, profileMemberId, bonusMemberId, missedMemberId, revokedMemberId] = users.map((user) => user.id);
    await db.memberBirthdayProfile.createMany({ data: [
      { userId: birthdayMemberId, birthDateEnc: encryptSensitive("2000-08-07"), birthMonth: 8, birthDay: 7, birthEffectiveAt: new Date("2026-01-01T00:00:00.000Z"), visibleOnWall: true, visibilityConsentedAt: now },
      { userId: senderId, birthDateEnc: encryptSensitive("2001-08-07"), birthMonth: 8, birthDay: 7, birthEffectiveAt: new Date("2026-01-01T00:00:00.000Z"), visibleOnWall: false },
      { userId: privateMemberId, birthDateEnc: encryptSensitive("2002-08-07"), birthMonth: 8, birthDay: 7, birthEffectiveAt: new Date("2026-01-01T00:00:00.000Z"), visibleOnWall: false },
      { userId: productMemberAId, birthDateEnc: encryptSensitive("2003-08-07"), birthMonth: 8, birthDay: 7, birthEffectiveAt: new Date("2026-01-01T00:00:00.000Z"), visibleOnWall: false },
      { userId: productMemberBId, birthDateEnc: encryptSensitive("2004-08-07"), birthMonth: 8, birthDay: 7, birthEffectiveAt: new Date("2026-01-01T00:00:00.000Z"), visibleOnWall: false },
      { userId: expiringMemberId, birthDateEnc: encryptSensitive("2005-08-07"), birthMonth: 8, birthDay: 7, birthEffectiveAt: new Date("2026-01-01T00:00:00.000Z"), visibleOnWall: false },
      { userId: revokedMemberId, birthDateEnc: encryptSensitive("2006-08-07"), birthMonth: 8, birthDay: 7, birthEffectiveAt: new Date("2026-01-01T00:00:00.000Z"), visibleOnWall: false },
    ] });
  });

  afterAll(async () => {
    await db.redemptionOrder.deleteMany({ where: { userId: { in: userIds } } });
    await db.notification.deleteMany({ where: { userId: { in: userIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }] } });
    await db.videoSecondaryReview.deleteMany({ where: { video: { userId: { in: userIds } } } });
    await db.videoSubmission.deleteMany({ where: { userId: { in: userIds } } });
    await db.birthdayWish.deleteMany({ where: { OR: [{ senderId: { in: userIds } }, { recipientId: { in: userIds } }] } });
    await db.birthdayPrize.deleteMany({ where: { annualBenefit: { userId: { in: userIds } } } });
    await db.birthdayAnnualBenefit.deleteMany({ where: { userId: { in: userIds } } });
    if (giftIds.length) {
      await db.birthdayPrizePoolItem.deleteMany({ where: { giftId: { in: giftIds } } });
      await db.gift.deleteMany({ where: { id: { in: giftIds } } });
    }
    await db.memberAchievement.deleteMany({ where: { userId: { in: userIds } } });
    await db.memberBirthdayProfile.deleteMany({ where: { userId: { in: userIds } } });
    const accounts = await db.pointAccount.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    await db.pointLedger.deleteMany({ where: { accountId: { in: accounts.map((account) => account.id) } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    for (const [key, previous] of previousSettings) {
      if (previous) await db.systemSetting.update({ where: { key }, data: previous });
      else await db.systemSetting.deleteMany({ where: { key } });
    }
    await db.$disconnect();
  });

  it("draws only once under concurrent requests and credits one ledger entry", async () => {
    const results = await Promise.all([
      drawBirthdayPrize({ userId: birthdayMemberId, idempotencyKey: `birthday-draw-a-${suffix}`, now, ticket: 0 }),
      drawBirthdayPrize({ userId: birthdayMemberId, idempotencyKey: `birthday-draw-b-${suffix}`, now, ticket: 50_000 }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(await db.birthdayPrize.count({ where: { annualBenefit: { userId: birthdayMemberId, benefitYear: 2026 } } })).toBe(1);
    expect(await db.pointLedger.count({ where: { type: "BIRTHDAY_DRAW_REWARD", referenceId: results[0].id } })).toBe(1);
  });

  it("updates one wish and never broadcasts birthday notifications to wall viewers", async () => {
    const beforeViewerNotifications = await db.notification.count({ where: { userId: senderId } });
    const wall = await getBirthdayWall(senderId, now);
    expect(wall.today.map((member) => member.userId)).toContain(birthdayMemberId);
    expect(wall.today.map((member) => member.userId)).not.toContain(privateMemberId);
    expect(await db.notification.count({ where: { userId: senderId } })).toBe(beforeViewerNotifications);
    await sendBirthdayWish({ senderId, recipientId: birthdayMemberId, benefitYear: 2026, presetCode: "HAPPY", now });
    await sendBirthdayWish({ senderId, recipientId: birthdayMemberId, benefitYear: 2026, presetCode: "HIGHLIGHTS", now });
    expect(await db.birthdayWish.count({ where: { senderId, recipientId: birthdayMemberId, benefitYear: 2026 } })).toBe(1);
    expect(await db.birthdayWish.findFirstOrThrow({ where: { senderId, recipientId: birthdayMemberId } }).then((wish) => wish.presetCode)).toBe("HIGHLIGHTS");
    expect(await db.notification.count({ where: { userId: birthdayMemberId, dedupeKey: `birthday:first-wish:${birthdayMemberId}:2026` } })).toBe(1);
  });

  it("grants and reverses a capped integer video bonus in the video transaction", async () => {
    const video = await db.videoSubmission.create({ data: { userId: senderId, sourceUrl: `https://v.kuaishou.com/birthday-${suffix}`, requestUrl: `https://v.kuaishou.com/birthday-${suffix}`, sourceKind: "short-link", submittedNickname: "祝福成员", submittedAt: now, birthdayBenefitYear: 2026, birthdayOccurrenceDate: occurrence, idempotencyKey: `birthday-video-${suffix}` } });
    await creditVideoReward({ videoId: video.id, userId: senderId, points: 100 });
    expect(await db.videoSubmission.findUniqueOrThrow({ where: { id: video.id } }).then((row) => row.birthdayBonusPoints)).toBe(20);
    expect(await db.pointLedger.count({ where: { referenceId: video.id, type: "BIRTHDAY_VIDEO_BONUS" } })).toBe(1);
    await revokeVideoReward({ videoId: video.id, actorId: adminId, reason: "生日加成撤销测试" });
    expect(await db.videoSubmission.findUniqueOrThrow({ where: { id: video.id } }).then((row) => row.birthdayBonusPoints)).toBe(0);
    expect(await db.birthdayAnnualBenefit.findUniqueOrThrow({ where: { userId_benefitYear: { userId: senderId, benefitYear: 2026 } } }).then((benefit) => benefit.bonusGranted)).toBe(0);
  });

  it("reserves gift inventory and falls back only after the pool is exhausted", async () => {
    const gift = await db.gift.create({ data: { name: `生日测试礼物-${suffix}`, kind: "PHYSICAL", pointsCost: 100, stock: 1 } });
    giftIds.push(gift.id);
    const item = await configureBirthdayPoolItem({ actorId: adminId, giftId: gift.id, quantity: 1 });
    expect(item.remainingStock).toBe(1);
    expect(await db.gift.findUniqueOrThrow({ where: { id: gift.id } }).then((row) => row.stock)).toBe(0);

    const prizes = await Promise.all([
      drawBirthdayPrize({ userId: productMemberAId, idempotencyKey: `birthday-product-a-${suffix}`, now, ticket: 92_000 }),
      drawBirthdayPrize({ userId: productMemberBId, idempotencyKey: `birthday-product-b-${suffix}`, now, ticket: 92_000 }),
    ]);
    expect(prizes.filter((prize) => prize.kind === "GIFT")).toHaveLength(1);
    expect(prizes.filter((prize) => prize.kind === "POINTS" && prize.fallback && prize.points === 50)).toHaveLength(1);
    expect(await db.birthdayPrizePoolItem.findUniqueOrThrow({ where: { id: item.id } }).then((row) => row.remainingStock)).toBe(0);

    const productPrize = prizes.find((prize) => prize.kind === "GIFT")!;
    const firstOrder = await claimBirthdayGift({
      userId: productPrize.annualBenefit.userId,
      prizeId: productPrize.id,
      idempotencyKey: `birthday-claim-${suffix}`,
      recipientName: "测试收件人",
      phone: "13800138000",
      address: "测试地址 1 号",
      now,
    });
    const repeatedOrder = await claimBirthdayGift({
      userId: productPrize.annualBenefit.userId,
      prizeId: productPrize.id,
      idempotencyKey: `birthday-claim-repeat-${suffix}`,
      now,
    });
    expect(repeatedOrder.id).toBe(firstOrder.id);
    expect(firstOrder.totalCost).toBe(0);
    expect(firstOrder.recipientPhoneEnc).not.toContain("13800138000");
  });

  it("returns an unclaimed product to the shop after 30 days", async () => {
    const gift = await db.gift.create({ data: { name: `生日逾期礼物-${suffix}`, kind: "PHYSICAL", pointsCost: 100, stock: 1 } });
    giftIds.push(gift.id);
    await configureBirthdayPoolItem({ actorId: adminId, giftId: gift.id, quantity: 1 });
    const prize = await drawBirthdayPrize({ userId: expiringMemberId, idempotencyKey: `birthday-expiring-${suffix}`, now, ticket: 92_000 });
    expect(prize.kind).toBe("GIFT");

    await extendBirthdayWindow({ actorId: adminId, target: "CLAIM", id: prize.id, days: 7, reason: "测试延长领奖窗口" });
    await runBirthdayMaintenance(new Date(now.getTime() + 31 * 86_400_000));
    expect(await db.birthdayPrize.findUniqueOrThrow({ where: { id: prize.id } }).then((row) => row.status)).toBe("PENDING_CLAIM");
    expect(await db.gift.findUniqueOrThrow({ where: { id: gift.id } }).then((row) => row.stock)).toBe(0);
    await runBirthdayMaintenance(new Date(now.getTime() + 38 * 86_400_000));
    expect(await db.birthdayPrize.findUniqueOrThrow({ where: { id: prize.id } }).then((row) => row.status)).toBe("EXPIRED");
    expect(await db.gift.findUniqueOrThrow({ where: { id: gift.id } }).then((row) => row.stock)).toBe(1);
  });

  it("returns revoked unclaimed inventory exactly once", async () => {
    const gift = await db.gift.create({ data: { name: `生日撤回礼物-${suffix}`, kind: "PHYSICAL", pointsCost: 100, stock: 1 } });
    giftIds.push(gift.id);
    await configureBirthdayPoolItem({ actorId: adminId, giftId: gift.id, quantity: 1 });
    const prize = await drawBirthdayPrize({ userId: revokedMemberId, idempotencyKey: `birthday-revoked-${suffix}`, now, ticket: 92_000 });
    await revokeBirthdayPrize({ actorId: adminId, prizeId: prize.id, reason: "测试撤回生日礼物", now });
    expect(await db.birthdayPrize.findUniqueOrThrow({ where: { id: prize.id } }).then((row) => row.status)).toBe("REVOKED");
    expect(await db.gift.findUniqueOrThrow({ where: { id: gift.id } }).then((row) => row.stock)).toBe(1);
    await expect(revokeBirthdayPrize({ actorId: adminId, prizeId: prize.id, reason: "重复撤回", now })).rejects.toThrow("尚未领奖");
    expect(await db.gift.findUniqueOrThrow({ where: { id: gift.id } }).then((row) => row.stock)).toBe(1);
  });

  it("delays profile activation for seven days and enforces the rolling change interval", async () => {
    const pending = await updateMemberBirthday({ userId: profileMemberId, birthday: "1999-08-20", visibleOnWall: true, now });
    expect(pending.birthMonth).toBeNull();
    expect(pending.pendingEffectiveAt).toEqual(new Date(now.getTime() + 7 * 86_400_000));
    expect(await applyPendingBirthdayProfiles(new Date(now.getTime() + 7 * 86_400_000 - 1))).toBe(0);
    expect(await getBirthdayWall(senderId, now).then((wall) => wall.upcoming.some((member) => member.userId === profileMemberId))).toBe(false);

    expect(await applyPendingBirthdayProfiles(new Date(now.getTime() + 7 * 86_400_000))).toBe(1);
    expect(await getBirthdayWall(senderId, now).then((wall) => wall.upcoming.some((member) => member.userId === profileMemberId))).toBe(true);
    await expect(updateMemberBirthday({ userId: profileMemberId, birthday: "1999-08-21", now: new Date(now.getTime() + 365 * 86_400_000 - 1) })).rejects.toThrow("365 天");
    await expect(updateMemberBirthday({ userId: profileMemberId, birthday: "1999-08-21", now: new Date(now.getTime() + 365 * 86_400_000) })).resolves.toMatchObject({ pendingBirthMonth: 8, pendingBirthDay: 21 });
  });

  it("blocks inactive members from drawing", async () => {
    await db.user.update({ where: { id: privateMemberId }, data: { active: false } });
    await expect(drawBirthdayPrize({ userId: privateMemberId, idempotencyKey: `birthday-inactive-${suffix}`, now, ticket: 0 })).rejects.toThrow("不能参加");
    await expect(getBirthdayWall(privateMemberId, now)).rejects.toThrow("不能查看");
    await expect(sendBirthdayWish({ senderId: privateMemberId, recipientId: birthdayMemberId, benefitYear: 2026, presetCode: "HAPPY", now })).rejects.toThrow("不能发送");
    await db.user.update({ where: { id: privateMemberId }, data: { active: true } });
  });

  it("does not backfill benefits when the birthday occurs during the activation delay", async () => {
    await updateMemberBirthday({ userId: missedMemberId, birthday: "1998-08-10", visibleOnWall: true, now });
    const afterActivation = new Date(now.getTime() + 7 * 86_400_000);
    await applyPendingBirthdayProfiles(afterActivation);
    await expect(drawBirthdayPrize({ userId: missedMemberId, idempotencyKey: `birthday-missed-${suffix}`, now: afterActivation, ticket: 0 })).rejects.toThrow("不补发");
    const wall = await getBirthdayWall(senderId, afterActivation);
    expect([...wall.today, ...wall.wishable, ...wall.upcoming].some((member) => member.userId === missedMemberId)).toBe(false);
  });

  it("caps concurrent video bonuses at 500 points", async () => {
    const videos = await Promise.all([1, 2].map((index) => db.videoSubmission.create({
      data: {
        userId: bonusMemberId,
        sourceUrl: `https://v.kuaishou.com/birthday-bonus-${index}-${suffix}`,
        requestUrl: `https://v.kuaishou.com/birthday-bonus-${index}-${suffix}`,
        sourceKind: "short-link",
        submittedNickname: "加成成员",
        submittedAt: now,
        birthdayBenefitYear: 2026,
        birthdayOccurrenceDate: occurrence,
        idempotencyKey: `birthday-bonus-${index}-${suffix}`,
      },
    })));
    await Promise.all(videos.map((video) => creditVideoReward({ videoId: video.id, userId: bonusMemberId, points: 2_000 })));
    expect(await db.birthdayAnnualBenefit.findUniqueOrThrow({ where: { userId_benefitYear: { userId: bonusMemberId, benefitYear: 2026 } } }).then((benefit) => benefit.bonusGranted)).toBe(500);
    expect(await db.pointLedger.aggregate({ where: { type: "BIRTHDAY_VIDEO_BONUS", referenceId: { in: videos.map((video) => video.id) } }, _sum: { amount: true } }).then((result) => result._sum.amount)).toBe(500);
  });
});

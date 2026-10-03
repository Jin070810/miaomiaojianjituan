import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { inspectFinancialIntegrity, readFinancialIntegrity } from "@/lib/integrity-reconciliation";

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("运维对账业务边界", () => {
  const userIds: string[] = [];
  const giftIds: string[] = [];
  const auditIds: string[] = [];
  const periodIds: string[] = [];
  const suffix = `${Date.now()}-${Math.random()}`;
  let ownerId: string;
  let giftId: string;
  let otherGiftId: string;
  async function member(label: string) {
    const user = await db.user.create({ data: { kuaishouId: `integrity-${label}-${suffix}`, nickname: label, passwordHash: "fixture", account: { create: {} } }, include: { account: true } });
    userIds.push(user.id);
    return user;
  }
  beforeAll(async () => {
    ownerId = (await member("birthday")).id;
    for (const name of ["birthday-gift", "other-gift"]) {
      giftIds.push((await db.gift.create({ data: { name, pointsCost: 100, stock: 5 } })).id);
    }
    [giftId, otherGiftId] = giftIds;
  });
  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { id: { in: auditIds } } });
    await db.redemptionOrder.deleteMany({ where: { userId: { in: userIds } } });
    await db.birthdayPrize.deleteMany({ where: { annualBenefit: { userId: { in: userIds } } } });
    await db.birthdayAnnualBenefit.deleteMany({ where: { userId: { in: userIds } } });
    await db.videoSubmission.deleteMany({ where: { userId: { in: userIds } } });
    await db.weeklyChallengePeriod.deleteMany({ where: { id: { in: periodIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.gift.deleteMany({ where: { id: { in: giftIds } } });
    await db.$disconnect();
  });
  let year = 2030;
  async function birthdayOrder() {
    const benefit = await db.birthdayAnnualBenefit.create({ data: {
      userId: ownerId, benefitYear: year++, occurrenceDate: new Date(), drawOpensAt: new Date(), drawClosesAt: new Date(),
    } });
    const prize = await db.birthdayPrize.create({ data: {
      annualBenefitId: benefit.id, kind: "GIFT", status: "CLAIMED", giftId, ticket: 99999, drawIdempotencyKey: benefit.id,
    } });
    return db.redemptionOrder.create({ data: { userId: ownerId, giftId, birthdayPrizeId: prize.id, quantity: 1, unitCost: 0, totalCost: 0, idempotencyKey: prize.id } });
  }
  it("accepts a zero-cost birthday gift and its fulfilled/refunded history", async () => {
    const order = await birthdayOrder();
    for (const status of ["PENDING", "FULFILLED", "REFUNDED"] as const) {
      await db.redemptionOrder.update({ where: { id: order.id }, data: { status } });
      expect((await inspectFinancialIntegrity()).invalidOrders.map(row => row.id)).not.toContain(order.id);
    }
  });
  it("still rejects ordinary free orders and incorrect birthday prices, quantities, owners, gifts or prize states", async () => {
    const other = await member("wrong-owner");
    const mutations = [
      { birthdayPrizeId: null }, { quantity: 2 }, { unitCost: -1, totalCost: -1 }, { unitCost: 1, totalCost: 1 },
      { userId: other.id }, { giftId: otherGiftId },
    ];
    for (const mutation of mutations) {
      const order = await birthdayOrder();
      await db.redemptionOrder.update({ where: { id: order.id }, data: mutation });
      expect((await inspectFinancialIntegrity()).invalidOrders.map(row => row.id)).toContain(order.id);
    }
    const order = await birthdayOrder();
    await db.birthdayPrize.update({ where: { id: order.birthdayPrizeId! }, data: { status: "PENDING_CLAIM" } });
    expect((await inspectFinancialIntegrity()).invalidOrders.map(row => row.id)).toContain(order.id);
  });
  it("reports oversized price multiplication as an invalid order rather than overflowing the SQL check", async () => {
    const order = await db.redemptionOrder.create({ data: { userId: ownerId, giftId, quantity: 2_000_000_000, unitCost: 2_000_000_000, totalCost: 1, idempotencyKey: `overflow-${suffix}` } });
    expect((await inspectFinancialIntegrity()).invalidOrders.map(row => row.id)).toContain(order.id);
  });
  async function debt(label: string, withAudit: boolean, ordinary = false) {
    const user = await member(label);
    const accountId = user.account!.id;
    const video = await db.videoSubmission.create({ data: { userId: user.id, submittedNickname: user.nickname, sourceUrl: "https://v.kuaishou.com/fixture", requestUrl: "https://v.kuaishou.com/fixture", sourceKind: "short-link", status: "REVOKED", points: 100, idempotencyKey: `video-${user.id}` } });
    await db.pointLedger.createMany({ data: [
      { accountId, type: "VIDEO_REWARD", amount: 100, balanceAfter: 100, referenceId: video.id },
      { accountId, type: "TRANSFER_OUT", amount: -80, balanceAfter: 20, referenceId: `spent-${user.id}` },
      { accountId, type: ordinary ? "TRANSFER_OUT" : "REVERSAL", amount: -100, balanceAfter: -80, referenceId: video.id },
    ] });
    await db.pointAccount.update({ where: { id: accountId }, data: { balance: -80 } });
    if (withAudit) auditIds.push((await db.auditLog.create({ data: { action: "VIDEO_REVOKED", entity: "VideoSubmission", entityId: video.id } })).id);
    return { user, accountId };
  }
  it("classifies a fully reconciled audited compensation as business debt, and preserves it in the report", async () => {
    const { accountId } = await debt("known-debt", true);
    const report = await inspectFinancialIntegrity();
    expect(report.negativeBalances.map(row => row.accountId)).toContain(accountId);
    expect(report.compensatingDebts.map(row => row.accountId)).toContain(accountId);
    expect(report.unexplainedNegativeBalances.map(row => row.accountId)).not.toContain(accountId);
    expect(report.balanceMismatches.map(row => row.accountId)).not.toContain(accountId);
  });
  it("does not hide an ordinary overdraft, unaudited reversal, or a balance mismatch as business debt", async () => {
    const unknown = await debt("missing-audit", false);
    const overdraft = await debt("ordinary-overdraft", true, true);
    const mismatch = await debt("mismatch", true);
    await db.pointAccount.update({ where: { id: mismatch.accountId }, data: { balance: -81 } });
    const report = await inspectFinancialIntegrity();
    for (const { accountId } of [unknown, overdraft, mismatch]) {
      expect(report.unexplainedNegativeBalances.map(row => row.accountId)).toContain(accountId);
      expect(report.compensatingDebts.map(row => row.accountId)).not.toContain(accountId);
    }
    expect(report.balanceMismatches.map(row => row.accountId)).toContain(mismatch.accountId);
  });
  it("does not excuse a second reversal beyond the original credited reward", async () => {
    const { accountId } = await debt("over-reversal", true);
    const original = await db.pointLedger.findFirstOrThrow({ where: { accountId, type: "REVERSAL" } });
    await db.pointLedger.create({ data: { accountId, type: "REVERSAL", amount: -5, balanceAfter: -85, referenceId: original.referenceId } });
    await db.pointAccount.update({ where: { id: accountId }, data: { balance: -85 } });
    expect((await inspectFinancialIntegrity()).unexplainedNegativeBalances.map(row => row.accountId)).toContain(accountId);
  });
  it("recognizes an audited video point correction without allowing arbitrary admin overdrafts", async () => {
    const { user, accountId } = await debt("video-correction", false);
    await db.pointLedger.updateMany({ where: { accountId, type: "REVERSAL" }, data: { type: "ADMIN_ADJUSTMENT" } });
    const ledger = await db.pointLedger.findFirstOrThrow({ where: { accountId, type: "ADMIN_ADJUSTMENT" } });
    auditIds.push((await db.auditLog.create({ data: { actorId: user.id, action: "VIDEO_POINTS_ADJUSTED", entity: "VideoSubmission", entityId: ledger.referenceId! } })).id);
    expect((await inspectFinancialIntegrity()).compensatingDebts.map(row => row.accountId)).toContain(accountId);
  });
  it("recognizes weekly compensation even after a race winner row is reassigned to another member", async () => {
    const memberA = await member("weekly-old");
    const memberB = await member("weekly-new");
    const period = await db.weeklyChallengePeriod.create({ data: {
      periodStart: new Date("2088-01-01"), periodEnd: new Date("2088-01-08"), claimEndsAt: new Date("2088-01-15"),
      model: "fixture", audienceSnapshot: [], audienceCount: 2,
    } });
    periodIds.push(period.id);
    const fields = { periodId: period.id, type: "VIDEO_COUNT" as const, weeklyVideoCounts: [], weeklyLikeSums: [], rewardPoints: 100, difficultyScore: 1, title: "fixture", description: "fixture", aiReason: "fixture" };
    const a = await db.weeklyChallengeAssignment.create({ data: { ...fields, userId: memberA.id, status: "REVERSED", reversedAt: new Date() } });
    const b = await db.weeklyChallengeAssignment.create({ data: { ...fields, userId: memberB.id } });
    const winner = await db.weeklyRaceWinner.create({ data: { periodId: period.id, assignmentId: b.id, userId: memberB.id, rewardPoints: 100, wonAt: new Date() } });
    const accountId = memberA.account!.id;
    await db.pointLedger.createMany({ data: [
      { accountId, type: "WEEKLY_CHALLENGE_REWARD", amount: 100, balanceAfter: 100, referenceId: a.id },
      { accountId, type: "WEEKLY_RACE_REWARD", amount: 100, balanceAfter: 200, referenceId: winner.id },
      { accountId, type: "TRANSFER_OUT", amount: -180, balanceAfter: 20 },
      { accountId, type: "WEEKLY_CHALLENGE_REVERSAL", amount: -100, balanceAfter: -80, referenceId: a.id },
      { accountId, type: "WEEKLY_RACE_REVERSAL", amount: -100, balanceAfter: -180, referenceId: winner.id, idempotencyKey: `weekly-race:${period.id}:reversal:${a.id}` },
    ] });
    await db.pointAccount.update({ where: { id: accountId }, data: { balance: -180 } });
    auditIds.push((await db.auditLog.create({ data: { action: "WEEKLY_CHALLENGE_REVERSED", entity: "WeeklyChallengeAssignment", entityId: a.id } })).id);
    expect((await inspectFinancialIntegrity()).compensatingDebts.map(row => row.accountId)).toContain(accountId);
  });
  it("uses one database snapshot while an independent point transaction commits", async () => {
    const user = await member("snapshot");
    const accountId = user.account!.id;
    await db.$transaction(async tx => {
      await tx.pointAccount.findUniqueOrThrow({ where: { id: accountId } });
      await db.$transaction(async writer => {
        await writer.pointAccount.update({ where: { id: accountId }, data: { balance: 25 } });
        await writer.pointLedger.create({ data: { accountId, type: "ADMIN_ADJUSTMENT", amount: 25, balanceAfter: 25 } });
      });
      const snapshot = await readFinancialIntegrity(tx);
      expect(snapshot.balanceMismatches.map(row => row.accountId)).not.toContain(accountId);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });
    expect((await inspectFinancialIntegrity()).balanceMismatches.map(row => row.accountId)).not.toContain(accountId);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { listMemberClearanceAdmin } from "@/lib/member-clearance";
import { listVoluntaryMemberExits, voluntarilyExitMember } from "@/lib/member-voluntary-exit";

const enabled = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("member voluntary exit database integration", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let userId = "";
  let accountId = "";
  let giftId = "";
  let eligibilityId = "";
  let policyId = "";

  beforeAll(async () => {
    const user = await db.user.create({
      data: {
        kuaishouId: `voluntary-exit-${suffix}`,
        nickname: "主动退团测试成员",
        passwordHash: "test",
        account: { create: { balance: 200 } },
      },
      include: { account: true },
    });
    userId = user.id;
    accountId = user.account!.id;
    const latest = await db.membershipClearancePolicyVersion.aggregate({ _max: { version: true } });
    const policy = await db.membershipClearancePolicyVersion.create({
      data: { version: (latest._max.version ?? 0) + 1, inactivityDays: 30, warningDays: [7, 3], cooldownDays: 15 },
    });
    policyId = policy.id;
    const eligibility = await db.memberEligibility.create({
      data: { userId, policyVersionId: policyId, cycleStartedAt: new Date() },
    });
    eligibilityId = eligibility.id;
    const gift = await db.gift.create({ data: { name: `主动退团礼品-${suffix}`, pointsCost: 100, stock: 0 } });
    giftId = gift.id;
    await db.redemptionOrder.create({
      data: { userId, giftId, unitCost: 100, totalCost: 100, status: "APPROVED", idempotencyKey: `voluntary-exit-order-${suffix}` },
    });
    await db.session.create({ data: { id: `voluntary-exit-session-${suffix}`, userId, expiresAt: new Date(Date.now() + 86_400_000) } });
    await db.videoSubmission.create({
      data: {
        userId,
        sourceUrl: "https://example.com/video",
        requestUrl: "https://example.com/video",
        sourceKind: "URL",
        submittedNickname: "主动退团测试成员",
        idempotencyKey: `voluntary-exit-video-${suffix}`,
      },
    });
  });

  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { entityId: { in: [userId, eligibilityId] } } });
    await db.gift.deleteMany({ where: { id: giftId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.membershipClearancePolicyVersion.deleteMany({ where: { id: policyId } });
    await db.$disconnect();
  });

  it("并发请求只执行一次，并清空积分、订单和会话", async () => {
    const results = await Promise.all([
      voluntarilyExitMember({ userId, reason: "其他原因", requestId: `exit-${suffix}` }),
      voluntarilyExitMember({ userId, reason: "其他原因", requestId: `exit-${suffix}-retry` }),
    ]);

    expect(results.filter((result) => !result.alreadyExited)).toHaveLength(1);
    expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ active: false, guildStatus: "已退团" });
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(await db.redemptionOrder.count({ where: { userId } })).toBe(0);
    expect(await db.gift.findUniqueOrThrow({ where: { id: giftId } })).toMatchObject({ stock: 1 });
    expect(await db.pointAccount.findUniqueOrThrow({ where: { id: accountId } })).toMatchObject({ balance: 0 });
    expect(await db.pointLedger.count({ where: { accountId, type: "MEMBER_VOLUNTARY_EXIT_FORFEIT" } })).toBe(1);
    expect(await db.videoSubmission.findFirstOrThrow({ where: { userId } })).toMatchObject({ status: "REJECTED", points: 0 });
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "MEMBER_VOLUNTARILY_LEFT", entityId: userId } })).toMatchObject({ reason: "其他原因" });
    expect(await db.memberEligibility.findUniqueOrThrow({ where: { id: eligibilityId } })).toMatchObject({ status: "EXEMPT", clearedAt: null });

    const clearanceAdmin = await listMemberClearanceAdmin();
    expect(clearanceAdmin.clearedMembers.some((row) => row.id === eligibilityId)).toBe(false);
    const voluntaryExits = await listVoluntaryMemberExits({ skip: 0, take: 50, search: `voluntary-exit-${suffix}` });
    expect(voluntaryExits.exits).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId, reason: "其他原因", forfeitedPoints: 200, clearedOrders: 1 }),
    ]));

    // A member who was auto-cleared in an older cycle still belongs only to the
    // voluntary-exit list after their current eligibility becomes exempt.
    await db.memberEligibility.update({ where: { id: eligibilityId }, data: { clearedAt: new Date() } });
    await db.auditLog.create({
      data: { action: "MEMBER_AUTO_CLEARED", entity: "MemberEligibility", entityId: eligibilityId },
    });
    const clearanceAfterHistoricalAutoEvent = await listMemberClearanceAdmin();
    expect(clearanceAfterHistoricalAutoEvent.clearedMembers.some((row) => row.id === eligibilityId)).toBe(false);
  });
});

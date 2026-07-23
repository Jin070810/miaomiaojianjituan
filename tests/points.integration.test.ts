import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { adminAdjustPoints, adminAdjustPointsBatch, completeTransfer, creditVideoReward, redeemGift, resolveVideoAppeal, revokeVideoReward, updateRedemptionOrder } from "@/lib/points";
import { claimRankingAward, periodBounds, settleRanking } from "@/lib/rankings";
import { prepareVideoReprocess } from "@/lib/video-jobs";

const enabled = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("积分事务并发", () => {
  let senderId = "";
  let receiverId = "";
  let giftId = "";
  let cashGiftId = "";
  const rankingPeriodIds: string[] = [];

  beforeAll(async () => {
    const suffix = Date.now().toString();
    const sender = await db.user.create({
      data: { kuaishouId: `test-sender-${suffix}`, nickname: "测试转出", passwordHash: "test", account: { create: { balance: 500 } } },
    });
    const receiver = await db.user.create({
      data: { kuaishouId: `test-receiver-${suffix}`, nickname: "测试转入", passwordHash: "test", account: { create: { balance: 0 } } },
    });
    senderId = sender.id;
    receiverId = receiver.id;
  });

  afterAll(async () => {
    await db.redemptionOrder.deleteMany({ where: { giftId: { in: [giftId, cashGiftId].filter(Boolean) } } });
    await db.transfer.deleteMany({ where: { OR: [{ senderId }, { receiverId }] } });
    const accounts = await db.pointAccount.findMany({ where: { userId: { in: [senderId, receiverId] } }, select: { id: true } });
    await db.pointLedger.deleteMany({ where: { accountId: { in: accounts.map((item) => item.id) } } });
    await db.user.deleteMany({ where: { id: { in: [senderId, receiverId] } } });
    if (rankingPeriodIds.length) await db.rankingPeriod.deleteMany({ where: { id: { in: rankingPeriodIds } } });
    if (giftId) await db.gift.deleteMany({ where: { id: giftId } });
    if (cashGiftId) await db.gift.deleteMany({ where: { id: cashGiftId } });
    await db.$disconnect();
  });

  it("is idempotent and never overspends under concurrent requests", async () => {
    const duplicate = await Promise.all([
      completeTransfer({ senderId, receiverId, amount: 100, idempotencyKey: "integration-duplicate" }),
      completeTransfer({ senderId, receiverId, amount: 100, idempotencyKey: "integration-duplicate" }),
    ]);
    expect(duplicate[0].id).toBe(duplicate[1].id);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) => completeTransfer({ senderId, receiverId, amount: 100, idempotencyKey: `integration-${index}` })),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(4);
    expect(await db.pointAccount.findUnique({ where: { userId: senderId } }).then((account) => account?.balance)).toBe(0);
  });

  it("credits a video only once", async () => {
    await db.pointAccount.update({ where: { userId: senderId }, data: { balance: 0 } });
    const video = await db.videoSubmission.create({
      data: {
        userId: senderId,
        sourceUrl: "https://v.kuaishou.com/integration",
        requestUrl: "https://v.kuaishou.com/integration",
        sourceKind: "short-link",
        submittedNickname: "测试转出",
        idempotencyKey: "integration-video",
      },
    });
    await Promise.all([
      creditVideoReward({ videoId: video.id, userId: senderId, points: 50 }),
      creditVideoReward({ videoId: video.id, userId: senderId, points: 50 }),
      creditVideoReward({ videoId: video.id, userId: senderId, points: 50 }),
    ]);
    expect(await db.pointLedger.count({ where: { referenceId: video.id } })).toBe(1);
    expect(await db.pointAccount.findUnique({ where: { userId: senderId } }).then((account) => account?.balance)).toBe(50);
  });

  it("reviews an appeal transactionally and credits only once under concurrency", async () => {
    await db.pointAccount.update({ where: { userId: senderId }, data: { balance: 0 } });
    const video = await db.videoSubmission.create({
      data: {
        userId: senderId,
        sourceUrl: "https://v.kuaishou.com/integration-appeal",
        requestUrl: "https://v.kuaishou.com/integration-appeal",
        sourceKind: "short-link",
        status: "REJECTED",
        likes: 500,
        photoId: `appeal-photo-${Date.now()}`,
        submittedNickname: "测试转出",
        idempotencyKey: `integration-appeal-video-${Date.now()}`,
      },
    });
    const appeal = await db.videoAppeal.create({
      data: {
        videoId: video.id,
        userId: senderId,
        reason: "作者名只是多了装饰字符",
        idempotencyKey: `integration-appeal-${Date.now()}`,
      },
    });
    const results = await Promise.all([
      resolveVideoAppeal({ appealId: appeal.id, action: "approve", points: 250, actorId: receiverId }),
      resolveVideoAppeal({ appealId: appeal.id, action: "approve", points: 250, actorId: receiverId }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(await db.videoSubmission.findUnique({ where: { id: video.id } }).then((item) => item?.status)).toBe("APPROVED");
    expect(await db.pointLedger.count({ where: { referenceId: video.id, type: "VIDEO_REWARD" } })).toBe(1);
    expect(await db.pointAccount.findUnique({ where: { userId: senderId } }).then((account) => account?.balance)).toBe(250);
  });

  it("reverses an approved video exactly once", async () => {
    await db.pointAccount.update({ where: { userId: senderId }, data: { balance: 0 } });
    const video = await db.videoSubmission.create({
      data: {
        userId: senderId,
        sourceUrl: "https://v.kuaishou.com/reversal",
        requestUrl: "https://v.kuaishou.com/reversal",
        sourceKind: "short-link",
        submittedNickname: "测试转出",
        idempotencyKey: "integration-reversal-video",
      },
    });
    await creditVideoReward({ videoId: video.id, userId: senderId, points: 50 });
    await db.pointAccount.update({ where: { userId: senderId }, data: { balance: 0 } });
    await Promise.all([
      revokeVideoReward({ videoId: video.id, actorId: senderId, reason: "测试撤销" }),
      revokeVideoReward({ videoId: video.id, actorId: senderId, reason: "测试撤销" }),
    ]);
    expect(await db.videoSubmission.findUnique({ where: { id: video.id } }).then((item) => item?.status)).toBe("REVOKED");
    expect(await db.pointLedger.count({ where: { referenceId: video.id, type: "REVERSAL" } })).toBe(1);
    expect(await db.pointAccount.findUnique({ where: { userId: senderId } }).then((account) => account?.balance)).toBe(-50);
  });

  it("allows a rejected photoId to be submitted again but blocks another active copy", async () => {
    const photoId = `integration-photo-${Date.now()}`;
    await db.videoSubmission.create({
      data: {
        userId: senderId,
        sourceUrl: "https://v.kuaishou.com/rejected-copy",
        requestUrl: "https://v.kuaishou.com/rejected-copy",
        sourceKind: "short-link",
        status: "REJECTED",
        photoId,
        submittedNickname: "测试转出",
        idempotencyKey: `integration-rejected-${photoId}`,
      },
    });
    await db.videoSubmission.create({
      data: {
        userId: senderId,
        sourceUrl: "https://v.kuaishou.com/active-copy",
        requestUrl: "https://v.kuaishou.com/active-copy",
        sourceKind: "short-link",
        status: "APPROVED",
        photoId,
        submittedNickname: "测试转出",
        idempotencyKey: `integration-active-${photoId}`,
      },
    });
    await expect(db.videoSubmission.create({
      data: {
        userId: receiverId,
        sourceUrl: "https://v.kuaishou.com/duplicate-active",
        requestUrl: "https://v.kuaishou.com/duplicate-active",
        sourceKind: "short-link",
        status: "PENDING_REVIEW",
        photoId,
        submittedNickname: "测试转入",
        idempotencyKey: `integration-duplicate-active-${photoId}`,
      },
    })).rejects.toThrow();
  });

  it("claims a rejected video for reprocessing only once", async () => {
    const video = await db.videoSubmission.create({
      data: {
        userId: senderId,
        sourceUrl: "https://v.kuaishou.com/reprocess",
        requestUrl: "https://v.kuaishou.com/reprocess",
        sourceKind: "short-link",
        status: "REJECTED",
        reviewReason: "临时抓取失败",
        submittedNickname: "测试转出",
        idempotencyKey: `integration-reprocess-${Date.now()}`,
      },
    });
    const results = await Promise.all([
      prepareVideoReprocess({ videoId: video.id, actorId: receiverId }),
      prepareVideoReprocess({ videoId: video.id, actorId: receiverId }),
      prepareVideoReprocess({ videoId: video.id, actorId: receiverId }),
    ]);
    expect(results.every((item) => item.status === "PROCESSING")).toBe(true);
    expect(await db.auditLog.count({ where: { action: "VIDEO_REPROCESS_REQUESTED", entityId: video.id } })).toBe(1);
  });

  it("settles a weekly video-count ranking once and creates top-five awards", async () => {
    const reference = new Date("2026-04-15T12:00:00.000Z");
    const bounds = periodBounds("week", reference);
    await db.rankingPeriod.deleteMany({ where: { type: "WEEK", periodStart: bounds.start } });
    await db.videoSubmission.create({
      data: {
        userId: senderId,
        sourceUrl: "https://v.kuaishou.com/ranking",
        requestUrl: "https://v.kuaishou.com/ranking",
        sourceKind: "short-link",
        status: "APPROVED",
        likes: 500,
        submittedNickname: "测试转出",
        submittedAt: new Date(bounds.start.getTime() + 60_000),
        idempotencyKey: "integration-ranking-video",
      },
    });
    const first = await settleRanking("week", reference, new Date(bounds.end.getTime() + 1));
    rankingPeriodIds.push(first.period.id);
    const second = await settleRanking("week", reference, new Date(bounds.end.getTime() + 2));
    expect(first.settled).toBe(true);
    expect(second.settled).toBe(false);
    expect(await db.rankingEntry.count({ where: { periodId: first.period.id, userId: senderId } })).toBe(1);
    expect(await db.rankingAward.count({ where: { periodId: first.period.id, userId: senderId } })).toBe(1);
    const award = await db.rankingAward.findFirstOrThrow({ where: { periodId: first.period.id, userId: senderId } });
    await db.rankingAward.update({ where: { id: award.id }, data: { status: "EXPIRED" } });
    await expect(claimRankingAward({ awardId: award.id, userId: senderId })).rejects.toThrow("已过期");
    const shippingAward = await db.rankingAward.create({
      data: { periodId: first.period.id, userId: receiverId, rank: 99, value: 0 },
    });
    const claimed = await claimRankingAward({
      awardId: shippingAward.id,
      userId: receiverId,
      recipientName: "测试收货人",
      phone: "13800138000",
      address: "上海市测试区榜单奖励地址 1 号",
    });
    expect(claimed.status).toBe("CLAIMED");
    expect(claimed.giftId).toBeNull();
  });

  it("refunds an order and restores stock only once", async () => {
    await db.pointAccount.update({ where: { userId: senderId }, data: { balance: 50 } });
    const gift = await db.gift.create({ data: { name: "测试礼品", pointsCost: 10, stock: 1 } });
    giftId = gift.id;
    const order = await redeemGift({
      userId: senderId,
      giftId,
      quantity: 1,
      idempotencyKey: "integration-redemption",
      recipient: { recipientName: "测试成员", phone: "13800138000", address: "上海市测试区测试路 1 号" },
    });
    await Promise.all([
      updateRedemptionOrder({ orderId: order.id, action: "refund", actorId: senderId, reason: "并发测试" }),
      updateRedemptionOrder({ orderId: order.id, action: "refund", actorId: senderId, reason: "并发测试" }),
    ]);
    expect(await db.gift.findUnique({ where: { id: giftId } }).then((item) => item?.stock)).toBe(1);
    expect(await db.pointLedger.count({ where: { referenceId: order.id, type: "REDEMPTION_REFUND" } })).toBe(1);
    expect(await db.pointAccount.findUnique({ where: { userId: senderId } }).then((account) => account?.balance)).toBe(50);
  });

  it("requires a QR code for cash redemption and stores a reusable recipient profile", async () => {
    const gift = await db.gift.create({ data: { name: "测试现金", kind: "CASH", pointsCost: 5, stock: 2 } });
    cashGiftId = gift.id;
    await expect(redeemGift({ userId: senderId, giftId: gift.id, quantity: 1, idempotencyKey: "integration-cash-missing" })).rejects.toThrow("收款码");
    const order = await redeemGift({
      userId: senderId,
      giftId: gift.id,
      quantity: 1,
      idempotencyKey: "integration-cash",
      recipient: { cashQrCodeUrl: "https://example.com/qr.png" },
    });
    expect(order.cashQrCodeUrl).toBe("https://example.com/qr.png");
    expect(order.status).toBe("APPROVED");
    expect(await db.recipientProfile.findUnique({ where: { userId: senderId } }).then((profile) => profile?.cashQrCodeUrl)).toBe("https://example.com/qr.png");
  });

  it("rejects an automatically approved order and restores points and stock", async () => {
    await db.pointAccount.update({ where: { userId: senderId }, data: { balance: 100 } });
    const gift = await db.gift.create({ data: { name: "测试驳回礼品", kind: "PHYSICAL", pointsCost: 20, stock: 2 } });
    const order = await redeemGift({
      userId: senderId,
      giftId: gift.id,
      quantity: 1,
      idempotencyKey: "integration-redemption-reject",
      recipient: { recipientName: "测试成员", phone: "13800138000", address: "上海市测试区测试路 1 号" },
    });
    expect(order.status).toBe("APPROVED");
    expect(await db.pointAccount.findUnique({ where: { userId: senderId } }).then((account) => account?.balance)).toBe(80);
    const rejected = await updateRedemptionOrder({ orderId: order.id, action: "reject", actorId: receiverId, reason: "暂不发放" });
    expect(rejected.status).toBe("REJECTED");
    expect(await db.gift.findUnique({ where: { id: gift.id } }).then((item) => item?.stock)).toBe(2);
    expect(await db.pointAccount.findUnique({ where: { userId: senderId } }).then((account) => account?.balance)).toBe(100);
    expect(await db.pointLedger.count({ where: { referenceId: order.id, type: "REDEMPTION_REFUND" } })).toBe(1);
    await db.redemptionOrder.delete({ where: { id: order.id } });
    await db.gift.delete({ where: { id: gift.id } });
  });

  it("blocks fulfillment when legacy recipient details are missing", async () => {
    const cash = await db.gift.create({ data: { name: "测试缺资料现金", kind: "CASH", pointsCost: 1, stock: 1 } });
    const physical = await db.gift.create({ data: { name: "测试缺资料实物", kind: "PHYSICAL", pointsCost: 1, stock: 1 } });
    const cashOrder = await db.redemptionOrder.create({
      data: { userId: senderId, giftId: cash.id, unitCost: 1, totalCost: 1, status: "APPROVED", idempotencyKey: `integration-missing-cash-${Date.now()}` },
    });
    const physicalOrder = await db.redemptionOrder.create({
      data: { userId: senderId, giftId: physical.id, unitCost: 1, totalCost: 1, status: "APPROVED", idempotencyKey: `integration-missing-physical-${Date.now()}` },
    });
    await expect(updateRedemptionOrder({ orderId: cashOrder.id, action: "fulfill", actorId: receiverId })).rejects.toThrow("收款码");
    await expect(updateRedemptionOrder({ orderId: physicalOrder.id, action: "fulfill", actorId: receiverId })).rejects.toThrow("收货资料");
    await db.redemptionOrder.deleteMany({ where: { id: { in: [cashOrder.id, physicalOrder.id] } } });
    await db.gift.deleteMany({ where: { id: { in: [cash.id, physical.id] } } });
  });

  it("applies integer admin adjustments once and prevents overspending", async () => {
    await db.pointAccount.update({ where: { userId: senderId }, data: { balance: 100 } });
    const idempotencyKey = `integration-admin-adjust-${Date.now()}`;
    const [first, duplicate] = await Promise.all([
      adminAdjustPoints({ userId: senderId, amount: 25, reason: "测试管理员发放", idempotencyKey, actorId: receiverId }),
      adminAdjustPoints({ userId: senderId, amount: 25, reason: "测试管理员发放", idempotencyKey, actorId: receiverId }),
    ]);
    expect(first.ledger.id).toBe(duplicate.ledger.id);
    expect(first.balance).toBe(125);
    expect(Number.isInteger(first.balance)).toBe(true);
    expect(await db.pointLedger.count({ where: { idempotencyKey } })).toBe(1);

    await adminAdjustPoints({
      userId: senderId,
      amount: -20,
      reason: "测试管理员扣除",
      idempotencyKey: `${idempotencyKey}-deduct`,
      actorId: receiverId,
    });
    await expect(adminAdjustPoints({
      userId: senderId,
      amount: -106,
      reason: "测试余额不足",
      idempotencyKey: `${idempotencyKey}-overspend`,
      actorId: receiverId,
    })).rejects.toThrow("积分余额不足");
    expect(await db.pointAccount.findUnique({ where: { userId: senderId } }).then((account) => account?.balance)).toBe(105);
  });

  it("applies a batch atomically and deduplicates each member", async () => {
    await db.pointAccount.updateMany({ where: { userId: { in: [senderId, receiverId] } }, data: { balance: 100 } });
    const key = `integration-bulk-${Date.now()}`;
    const first = await adminAdjustPointsBatch({
      userIds: [senderId, receiverId],
      amount: 25,
      reason: "测试批量奖励",
      idempotencyKey: key,
      actorId: receiverId,
    });
    const duplicate = await adminAdjustPointsBatch({
      userIds: [receiverId, senderId],
      amount: 25,
      reason: "测试批量奖励",
      idempotencyKey: key,
      actorId: receiverId,
    });
    expect(first.adjustments.map((item) => item.userId).sort()).toEqual([senderId, receiverId].sort());
    expect(duplicate.adjustments.map((item) => item.ledger.id).sort()).toEqual(first.adjustments.map((item) => item.ledger.id).sort());
    expect(await db.pointAccount.findUnique({ where: { userId: senderId } }).then((account) => account?.balance)).toBe(125);
    expect(await db.pointAccount.findUnique({ where: { userId: receiverId } }).then((account) => account?.balance)).toBe(125);

    await expect(adminAdjustPointsBatch({
      userIds: [senderId, receiverId],
      amount: -126,
      reason: "测试整批扣分失败",
      idempotencyKey: `${key}-overspend`,
      actorId: receiverId,
    })).rejects.toThrow("批量调整未执行");
    expect(await db.pointAccount.findUnique({ where: { userId: senderId } }).then((account) => account?.balance)).toBe(125);
    expect(await db.notification.count({ where: { entityType: "PointLedger", entityId: { in: first.adjustments.map((item) => item.ledger.id) } } })).toBe(2);
  });
});

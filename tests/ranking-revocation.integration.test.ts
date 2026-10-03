import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { claimRankingAward, getLiveRanking, periodBounds, previewRankingPeriod, settleRankingPeriod } from "@/lib/rankings";
import { revokeVideoReward } from "@/lib/points";
import { PATCH as updateAwardRoute } from "@/app/api/admin/rankings/awards/[id]/route";
import { resolveRankingAdjustment } from "@/lib/ranking-adjustments";
import { lockRankingPeriod } from "@/lib/ranking-period";
import { Prisma } from "@prisma/client";

const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ id: actor.id, role: "ADMIN" }) }));

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("settled ranking revocation policy", () => {
  const users: string[] = [];
  const periods: string[] = [];
  const gifts: string[] = [];
  let sequence = 0;

  beforeAll(async () => {
    const admin = await db.user.create({ data: { kuaishouId: `ranking-admin-${crypto.randomUUID()}`, nickname: "榜单管理员", role: "ADMIN", passwordHash: "test" } });
    actor.id = admin.id;
    users.push(admin.id);
  });

  afterAll(async () => {
    await db.rankingPeriod.deleteMany({ where: { id: { in: periods } } });
    await db.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.gift.deleteMany({ where: { id: { in: gifts } } });
    await db.$disconnect();
  });

  async function fixture(extraVideo = false) {
    const bounds = periodBounds("week", new Date(Date.UTC(2030, 0, 15 + sequence++ * 40)));
    const member = await db.user.create({ data: { kuaishouId: `ranking-member-${crypto.randomUUID()}`, nickname: "榜单测试成员", passwordHash: "test", account: { create: { balance: 0 } } } });
    users.push(member.id);
    const video = await db.videoSubmission.create({ data: { userId: member.id, sourceUrl: "https://v.kuaishou.com/ranking-policy", requestUrl: "https://v.kuaishou.com/ranking-policy", sourceKind: "short-link", submittedNickname: member.nickname, idempotencyKey: crypto.randomUUID(), status: "APPROVED", points: 0, likes: 300, submittedAt: new Date(bounds.start.getTime() + 60_000), reviewedAt: new Date(bounds.start.getTime() + 120_000) } });
    const secondVideo = extraVideo ? await db.videoSubmission.create({ data: { userId: member.id, sourceUrl: video.sourceUrl, requestUrl: video.requestUrl, sourceKind: video.sourceKind, submittedNickname: member.nickname, idempotencyKey: crypto.randomUUID(), status: "APPROVED", likes: 400, submittedAt: video.submittedAt } }) : null;
    const period = await db.rankingPeriod.create({ data: { type: "WEEK", periodStart: bounds.start, periodEnd: bounds.end } });
    periods.push(period.id);
    await settleRankingPeriod({ type: "week", periodStart: bounds.start, rewards: [{ rank: 1, title: "榜单测试礼物" }], actorId: actor.id, settledAt: bounds.end });
    const award = await db.rankingAward.findFirstOrThrow({ where: { periodId: period.id, userId: member.id } });
    return { member, video, secondVideo, period, award };
  }

  const recipient = { recipientName: "测试成员", phone: "13800000000", address: "测试用虚拟收货地址" };
  const patchAward = (id: string, body: object) => updateAwardRoute(new Request(`https://example.test/api/admin/rankings/awards/${id}`, { method: "PATCH", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

  it("keeps the original historical preview after a contributing video is revoked", async () => {
    const { video, period } = await fixture();
    const before = await previewRankingPeriod({ type: "week", periodStart: period.periodStart });
    await revokeVideoReward({ videoId: video.id, actorId: actor.id, reason: "测试撤销贡献视频" });
    const after = await previewRankingPeriod({ type: "week", periodStart: period.periodStart });
    expect(after.rankings).toEqual(before.rankings);
    expect(await db.rankingEntry.count({ where: { periodId: period.id } })).toBe(1);
  });

  it("blocks claim of an unpaid reward affected by a revoked contribution", async () => {
    const { member, video, award } = await fixture();
    await revokeVideoReward({ videoId: video.id, actorId: actor.id, reason: "测试冻结未领奖奖励" });
    await expect(claimRankingAward({ awardId: award.id, userId: member.id, ...recipient })).rejects.toThrow("冻结");
  });

  it("blocks fulfillment after an already claimed reward is frozen", async () => {
    const { member, video, award } = await fixture();
    await claimRankingAward({ awardId: award.id, userId: member.id, ...recipient });
    await revokeVideoReward({ videoId: video.id, actorId: actor.id, reason: "测试冻结待发奖励" });
    const response = await updateAwardRoute(new Request(`https://example.test/api/admin/rankings/awards/${award.id}`, { method: "PATCH", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ status: "FULFILLED" }) }), { params: Promise.resolve({ id: award.id }) });
    expect(response.ok).toBe(false);
    expect((await response.json()).error).toContain("冻结");
    expect((await db.rankingAward.findUniqueOrThrow({ where: { id: award.id } })).status).toBe("CLAIMED");
  });

  it("captures immutable contributions and rules, and ignores a video approved after settlement", async () => {
    const { member, video, period, award } = await fixture();
    const captured = await db.rankingPeriod.findUniqueOrThrow({ where: { id: period.id }, include: { contributions: true } });
    expect(captured.ruleSnapshot).toMatchObject({ version: "ranking-v1", metric: "videoCount", timezone: "Asia/Shanghai" });
    expect(captured.contributions).toMatchObject([{ videoId: video.id, likes: 300 }]);
    await db.videoSubmission.update({ where: { id: video.id }, data: { likes: 99_999 } });
    expect((await previewRankingPeriod({ type: "week", periodStart: period.periodStart })).rankings[0].likes).toBe(300);
    const late = await db.videoSubmission.create({ data: { userId: member.id, sourceUrl: video.sourceUrl, requestUrl: video.requestUrl, sourceKind: video.sourceKind, submittedNickname: member.nickname, idempotencyKey: crypto.randomUUID(), status: "APPROVED", submittedAt: video.submittedAt } });
    await revokeVideoReward({ videoId: late.id, actorId: actor.id, reason: "结算后才通过的历史周期视频" });
    expect(await db.rankingAwardAdjustment.count({ where: { awardId: award.id } })).toBe(0);
    await expect(claimRankingAward({ awardId: award.id, userId: member.id, ...recipient })).resolves.toMatchObject({ status: "CLAIMED" });
  });

  it("marks legacy relevance as uncertain without fabricating a historical contribution", async () => {
    const { video, period, award } = await fixture();
    await db.rankingContribution.deleteMany({ where: { periodId: period.id } });
    await db.rankingPeriod.update({ where: { id: period.id }, data: { contributionsCapturedAt: null, ruleSnapshot: Prisma.DbNull } });
    await revokeVideoReward({ videoId: video.id, actorId: actor.id, reason: "旧周期视频撤销" });
    expect(await db.rankingAwardAdjustment.findFirstOrThrow({ where: { awardId: award.id } })).toMatchObject({ kind: "FREEZE_UNPAID", source: "LEGACY_WINDOW" });
    expect(await db.rankingContribution.count({ where: { periodId: period.id } })).toBe(0);
  });

  it("keeps a paid award unchanged and records a replay-safe audited resolution", async () => {
    const { member, video, award } = await fixture();
    await claimRankingAward({ awardId: award.id, userId: member.id, ...recipient });
    const fulfilled = await patchAward(award.id, { status: "FULFILLED" });
    expect(fulfilled.ok).toBe(true);
    const publicAward = (await fulfilled.json()).award;
    expect(publicAward).not.toHaveProperty("recipientPhoneEnc");
    expect(publicAward).not.toHaveProperty("recipientAddressEnc");
    expect(publicAward).not.toHaveProperty("cashQrCodeUrl");
    const before = await db.rankingAward.findUniqueOrThrow({ where: { id: award.id } });
    await Promise.all([1, 2].map(() => revokeVideoReward({ videoId: video.id, actorId: actor.id, reason: "已发奖励的视频撤销" })));
    const task = await db.rankingAwardAdjustment.findFirstOrThrow({ where: { awardId: award.id } });
    expect(task).toMatchObject({ kind: "REVIEW_PAID", status: "PENDING", source: "SNAPSHOT" });
    expect(await db.rankingAwardAdjustment.count({ where: { awardId: award.id } })).toBe(1);
    expect(await db.rankingAward.findUniqueOrThrow({ where: { id: award.id } })).toEqual(before);
    await expect(resolveRankingAdjustment({ id: task.id, actorId: actor.id, resolution: "RELEASE", note: "不匹配的处理方式" })).rejects.toThrow("已发奖励");
    const input = { id: task.id, actorId: actor.id, resolution: "ADJUSTED" as const, note: "已联系成员完成线下调整，凭据编号 TEST-001" };
    await Promise.all([resolveRankingAdjustment(input), resolveRankingAdjustment(input)]);
    expect(await db.auditLog.count({ where: { entityId: task.id, action: "RANKING_AWARD_ADJUSTMENT_RESOLVED" } })).toBe(1);
    await expect(resolveRankingAdjustment({ ...input, note: "另一个不同处理依据" })).rejects.toThrow("其他处理结果");
    expect(await db.pointLedger.count({ where: { account: { userId: member.id } } })).toBe(0);
    expect(await db.rankingAward.findUniqueOrThrow({ where: { id: award.id } })).toEqual(before);
  });

  it("requires every freeze to be resolved and restores stock once when cancellation is replayed", async () => {
    const { member, video, secondVideo, award } = await fixture(true);
    const gift = await db.gift.create({ data: { name: "榜单库存测试", kind: "PHYSICAL", pointsCost: 50, stock: 5 } });
    gifts.push(gift.id);
    expect((await patchAward(award.id, { giftId: gift.id })).ok).toBe(true);
    expect((await db.gift.findUniqueOrThrow({ where: { id: gift.id } })).stock).toBe(4);
    await revokeVideoReward({ videoId: video.id, actorId: actor.id, reason: "第一条贡献撤销" });
    await revokeVideoReward({ videoId: secondVideo!.id, actorId: actor.id, reason: "第二条贡献撤销" });
    const tasks = await db.rankingAwardAdjustment.findMany({ where: { awardId: award.id }, orderBy: { createdAt: "asc" } });
    expect(tasks).toHaveLength(2);
    await resolveRankingAdjustment({ id: tasks[0].id, actorId: actor.id, resolution: "RELEASE", note: "本项相关性核实后解除冻结" });
    await expect(claimRankingAward({ awardId: award.id, userId: member.id, ...recipient })).rejects.toThrow("冻结");
    const cancel = { id: tasks[1].id, actorId: actor.id, resolution: "CANCEL" as const, note: "第二项确认影响奖励资格，取消该奖励" };
    await Promise.all([resolveRankingAdjustment(cancel), resolveRankingAdjustment(cancel)]);
    expect((await db.rankingAward.findUniqueOrThrow({ where: { id: award.id } })).status).toBe("EXPIRED");
    expect((await db.gift.findUniqueOrThrow({ where: { id: gift.id } })).stock).toBe(5);
    expect(await db.auditLog.count({ where: { entityId: award.id, action: "RANKING_AWARD_CANCELLED" } })).toBe(1);
    expect(await db.rankingAwardAdjustment.count({ where: { awardId: award.id, status: "PENDING" } })).toBe(0);
  });

  it("blocks legacy DB writers from claiming or fulfilling a frozen award", async () => {
    const { video, award } = await fixture();
    await revokeVideoReward({ videoId: video.id, actorId: actor.id, reason: "旧版写入冻结门禁" });
    for (const status of ["CLAIMED", "FULFILLED"] as const) {
      await expect(db.rankingAward.update({ where: { id: award.id }, data: { status } })).rejects.toThrow();
    }
    expect((await db.rankingAward.findUniqueOrThrow({ where: { id: award.id } })).status).toBe("PENDING");
    const task = await db.rankingAwardAdjustment.findFirstOrThrow({ where: { awardId: award.id } });
    await expect(db.rankingAwardAdjustment.update({ where: { id: task.id }, data: { status: "RESOLVED", resolvedById: actor.id, resolvedAt: new Date() } })).rejects.toThrow();
  });

  it("cancels all outstanding holds together and never renumbers retained historical entries", async () => {
    const { video, secondVideo, period, award, member } = await fixture(true);
    // Legacy historical gaps must not be silently renumbered by the read API.
    await db.rankingEntry.updateMany({ where: { periodId: period.id }, data: { rank: 3 } });
    await revokeVideoReward({ videoId: video.id, actorId: actor.id, reason: "第一项待取消贡献" });
    await revokeVideoReward({ videoId: secondVideo!.id, actorId: actor.id, reason: "第二项待取消贡献" });
    const tasks = await db.rankingAwardAdjustment.findMany({ where: { awardId: award.id } });
    await resolveRankingAdjustment({ id: tasks[0].id, actorId: actor.id, resolution: "CANCEL", note: "贡献全部撤销，取消本期未发奖励" });
    expect(await db.rankingAwardAdjustment.count({ where: { awardId: award.id, status: "RESOLVED", resolution: "CANCEL" } })).toBe(2);
    expect(await db.auditLog.count({ where: { entityId: { in: tasks.map((task) => task.id) }, action: "RANKING_AWARD_ADJUSTMENT_RESOLVED" } })).toBe(2);
    expect((await previewRankingPeriod({ type: "week", periodStart: period.periodStart })).rankings[0].rank).toBe(3);
    expect((await getLiveRanking("week", member.id, period.periodStart)).rankings[0].rank).toBe(3);
    expect((await db.rankingAward.findUniqueOrThrow({ where: { id: award.id } })).rank).toBe(1);
  });

  it("allows a member to claim only after the last hold is released", async () => {
    const { video, award, member } = await fixture();
    await revokeVideoReward({ videoId: video.id, actorId: actor.id, reason: "待核实的冻结贡献" });
    const task = await db.rankingAwardAdjustment.findFirstOrThrow({ where: { awardId: award.id } });
    await resolveRankingAdjustment({ id: task.id, actorId: actor.id, resolution: "RELEASE", note: "已核实依据，决定保留原奖励资格" });
    await expect(claimRankingAward({ awardId: award.id, userId: member.id, ...recipient })).resolves.toMatchObject({ status: "CLAIMED" });
    await expect(resolveRankingAdjustment({ id: task.id, actorId: member.id, resolution: "RELEASE", note: "已核实依据，决定保留原奖励资格" })).rejects.toThrow("其他处理结果");
  });

  it("serializes revoke and fulfill: only a blocked payout or an audited paid adjustment is possible", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { member, video, award } = await fixture();
      await claimRankingAward({ awardId: award.id, userId: member.id, ...recipient });
      const [response] = await Promise.all([patchAward(award.id, { status: "FULFILLED" }), revokeVideoReward({ videoId: video.id, actorId: actor.id, reason: "并发撤销与发放" })]);
      const after = await db.rankingAward.findUniqueOrThrow({ where: { id: award.id } });
      const task = await db.rankingAwardAdjustment.findFirstOrThrow({ where: { awardId: award.id } });
      expect(task.kind).toBe(after.status === "FULFILLED" ? "REVIEW_PAID" : "FREEZE_UNPAID");
      expect(response.ok).toBe(after.status === "FULFILLED");
      expect(await db.rankingAwardAdjustment.count({ where: { awardId: award.id } })).toBe(1);
    }
  });

  it.each(["settle-first", "revoke-first"] as const)("serializes %s across a not-yet-settled month", async (order) => {
    const { video, member } = await fixture();
    const bounds = periodBounds("month", video.submittedAt);
    const period = await db.rankingPeriod.create({ data: { type: "MONTH", periodStart: bounds.start, periodEnd: bounds.end } });
    periods.push(period.id);
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const blocker = db.$transaction(async (tx) => { await lockRankingPeriod(tx, "month", video.submittedAt); locked(); await gate; }, { timeout: 10_000 });
    await ready;
    const waiting = async (count: number) => {
      const until = Date.now() + 3000;
      while (Date.now() < until) {
        const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
        if (Number(rows[0].count) >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("并发测试未进入预期数据库锁等待");
    };
    const settle = () => settleRankingPeriod({ type: "month", periodStart: bounds.start, rewards: [{ rank: 1, title: "月榜测试奖励" }], actorId: actor.id, settledAt: bounds.end });
    const revoke = () => revokeVideoReward({ videoId: video.id, actorId: actor.id, reason: "结算并发撤销视频" });
    const first = order === "settle-first" ? settle() : revoke();
    let second: Promise<unknown> | undefined;
    try { await waiting(1); second = order === "settle-first" ? revoke() : settle(); await waiting(2); }
    finally { release(); await Promise.all([blocker, first, second]); }
    const award = await db.rankingAward.findFirst({ where: { periodId: period.id, userId: member.id } });
    if (order === "settle-first") {
      expect(award).not.toBeNull();
      expect(await db.rankingAwardAdjustment.findFirst({ where: { awardId: award!.id } })).toMatchObject({ kind: "FREEZE_UNPAID", source: "SNAPSHOT" });
    } else expect(award).toBeNull();
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { adminAdjustPoints, adminAdjustPointsBatch, completeTransfer, redeemGift } from "@/lib/points";

const mocks = vi.hoisted(() => ({ user: vi.fn(), enqueue: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentUser: mocks.user }));
vi.mock("@/lib/video-jobs", () => ({ enqueueVideo: mocks.enqueue }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(), RateLimitError: class extends Error {} }));
vi.mock("@/lib/operation-switches", () => ({ operationSwitchEnabled: async () => true, operationSwitchDefinitions: {} }));
vi.mock("@/lib/birthdays", async (original) => ({ ...await original<object>(), birthdaySubmissionEligibility: async () => null }));
import { POST as submitVideo } from "@/app/api/videos/route";
import { POST as submitOrder, GET as listOrders } from "@/app/api/redemptions/route";

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("request idempotency boundaries", () => {
  let users: Array<{ id: string; nickname: string }> = [];
  let giftId = "";
  const key = () => `request-contract-${randomUUID()}`;
  const request = (path: string, idempotencyKey: string, body: object) => new Request(`http://localhost/api/${path}`, {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify(body),
  });
  const cash = () => ({ userId: users[0].id, giftId, quantity: 1, recipient: { cashQrCodeUrl: "https://example.invalid/member-private-qr.png" }, idempotencyKey: key() });
  beforeAll(async () => {
    users = await Promise.all([0, 1, 2, 3, 4].map((n) => db.user.create({ data: {
      kuaishouId: key(), nickname: `幂等测试${n}`, role: n >= 3 ? "ADMIN" : "MEMBER", passwordHash: "fixture", account: { create: { balance: 10000 } },
    } })));
    giftId = (await db.gift.create({ data: { name: "幂等测试现金", kind: "CASH", pointsCost: 20, stock: 100, active: true } })).id;
  });
  afterAll(async () => {
    const ids = users.map((u) => u.id);
    await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await db.redemptionOrder.deleteMany({ where: { userId: { in: ids } } });
    await db.transfer.deleteMany({ where: { senderId: { in: ids } } });
    await db.pointLedger.deleteMany({ where: { account: { userId: { in: ids } } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    if (giftId) await db.gift.delete({ where: { id: giftId } });
    await db.$disconnect();
  });

  it("binds transfer retries to sender, recipient, amount and note", async () => {
    const input = { senderId: users[0].id, receiverId: users[1].id, amount: 10, note: "备注甲", idempotencyKey: key() };
    const first = await completeTransfer(input);
    expect((await completeTransfer(input)).id).toBe(first.id);
    for (const changed of [{ senderId: users[2].id }, { receiverId: users[2].id }, { amount: 11 }, { note: "备注乙" }]) {
      await expect(completeTransfer({ ...input, ...changed })).rejects.toMatchObject({ name: "IdempotencyConflictError" });
    }
    expect(await db.pointLedger.count({ where: { referenceId: first.id } })).toBe(2);
  });

  it("rejects competing transfer payloads even after a unique-key race", async () => {
    const input = { senderId: users[0].id, receiverId: users[1].id, amount: 10, idempotencyKey: key() };
    const outcomes = await Promise.allSettled([completeTransfer(input), completeTransfer({ ...input, amount: 12 })]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((r) => r.status === "rejected")).toMatchObject({ reason: { name: "IdempotencyConflictError" } });
  });

  it("binds a single admin adjustment to actor, target, amount and reason", async () => {
    const input = { actorId: users[3].id, userId: users[0].id, amount: 5, reason: "测试补发", idempotencyKey: key() };
    const first = await adminAdjustPoints(input);
    expect((await adminAdjustPoints(input)).ledger.id).toBe(first.ledger.id);
    for (const changed of [{ actorId: users[4].id }, { userId: users[1].id }, { amount: 6 }, { reason: "其他原因" }]) {
      await expect(adminAdjustPoints({ ...input, ...changed })).rejects.toMatchObject({ name: "IdempotencyConflictError" });
    }
  });

  it("binds batch adjustments to the original actor, selection, amount and reason", async () => {
    const input = { actorId: users[3].id, selectionMode: "EXPLICIT" as const, userIds: [users[0].id, users[1].id], amount: 5, reason: "批量补发", idempotencyKey: key() };
    const first = await adminAdjustPointsBatch(input);
    expect((await adminAdjustPointsBatch({ ...input, userIds: [...input.userIds].reverse() })).adjustments.map((r) => r.userId).sort()).toEqual(input.userIds.sort());
    for (const changed of [{ actorId: users[4].id }, { userIds: [users[0].id] }, { userIds: [users[2].id] }, { amount: 6 }, { reason: "其他原因" }, { selectionMode: "ALL_ACTIVE_MEMBERS" as const }]) {
      await expect(adminAdjustPointsBatch({ ...input, ...changed })).rejects.toMatchObject({ name: "IdempotencyConflictError" });
    }
    expect(first.adjustments).toHaveLength(2);
  });

  it("serializes concurrent batches even when the same key targets disjoint users", async () => {
    const input = { actorId: users[3].id, amount: 5, reason: "并发补发", idempotencyKey: key() };
    const outcomes = await Promise.allSettled([
      adminAdjustPointsBatch({ ...input, userIds: [users[0].id] }),
      adminAdjustPointsBatch({ ...input, userIds: [users[1].id] }),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((r) => r.status === "rejected")).toMatchObject({ reason: { name: "IdempotencyConflictError" } });
    expect(await db.pointLedger.count({ where: { referenceId: input.idempotencyKey } })).toBe(1);
  });

  it("does not confuse single, batch or prefixed per-member adjustment keys", async () => {
    const base = { actorId: users[3].id, amount: 5, reason: "请求类型边界" };
    const firstKey = key();
    await adminAdjustPoints({ ...base, userId: users[0].id, idempotencyKey: firstKey });
    await expect(adminAdjustPointsBatch({ ...base, userIds: [users[0].id], idempotencyKey: firstKey })).rejects.toMatchObject({ name: "IdempotencyConflictError" });
    const secondKey = key();
    await adminAdjustPointsBatch({ ...base, userIds: [users[0].id], idempotencyKey: secondKey });
    await expect(adminAdjustPoints({ ...base, userId: users[0].id, idempotencyKey: secondKey })).rejects.toMatchObject({ name: "IdempotencyConflictError" });
    await expect(adminAdjustPoints({ ...base, userId: users[0].id, idempotencyKey: `${secondKey}:${users[0].id}` })).rejects.toMatchObject({ name: "IdempotencyConflictError" });
  });

  it("binds redemption retries to the owner and the original request, independent of later profile changes", async () => {
    const input = cash();
    await redeemGift(input);
    const profileInput = { ...cash(), recipient: undefined };
    const first = await redeemGift(profileInput);
    await db.recipientProfile.update({ where: { userId: users[0].id }, data: { cashQrCodeUrl: "https://example.invalid/new.png" } });
    expect((await redeemGift(profileInput)).id).toBe(first.id);
    for (const changed of [{ userId: users[2].id }, { quantity: 2 }, { note: "变化" }, { shippingInfo: "变化" }, { recipient: { cashQrCodeUrl: "https://example.invalid/new.png" } }]) {
      await expect(redeemGift({ ...profileInput, ...changed })).rejects.toMatchObject({ name: "IdempotencyConflictError" });
    }
  });

  it("redeems identical concurrent requests once and rejects a changed concurrent request", async () => {
    const input = cash();
    const same = await Promise.all([redeemGift(input), redeemGift(input), redeemGift(input)]);
    expect(new Set(same.map((r) => r.id)).size).toBe(1);
    const other = cash();
    const outcomes = await Promise.allSettled([redeemGift(other), redeemGift({ ...other, quantity: 2 })]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((r) => r.status === "rejected")).toMatchObject({ reason: { name: "IdempotencyConflictError" } });
  });

  it("does not guess at an old redemption request without a fingerprint or debit it again", async () => {
    const input = cash();
    const first = await redeemGift(input);
    await db.auditLog.updateMany({ where: { action: "REDEMPTION_CREATED", entityId: first.id }, data: { afterValue: { giftId, quantity: 1 } } });
    await expect(redeemGift(input)).rejects.toMatchObject({ name: "IdempotencyConflictError" });
    expect(await db.pointLedger.count({ where: { referenceId: first.id } })).toBe(1);
  });

  it("binds membership answers while ignoring object-key order and keeping sensitive input out of audit JSON", async () => {
    const gift = await db.gift.create({ data: {
      name: "测试会员", kind: "MEMBERSHIP", pointsCost: 10, stock: 10, active: true,
      fulfillmentFields: [{ key: "email", label: "账号", type: "EMAIL", required: true }, { key: "platform", label: "平台", type: "TEXT", required: false }],
    } });
    try {
      const input = { userId: users[0].id, giftId: gift.id, quantity: 1, membershipAnswers: { email: "private@example.invalid", platform: "剪映" }, idempotencyKey: key() };
      const first = await redeemGift(input);
      expect((await redeemGift({ ...input, membershipAnswers: { platform: "剪映", email: "private@example.invalid" } })).id).toBe(first.id);
      await expect(redeemGift({ ...input, membershipAnswers: { ...input.membershipAnswers, email: "changed@example.invalid" } })).rejects.toMatchObject({ name: "IdempotencyConflictError" });
      const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: first.id, action: "REDEMPTION_CREATED" } });
      expect(audit.afterValue).toMatchObject({ requestFingerprint: expect.stringMatching(/^v1:[a-f0-9]{64}$/) });
      expect(JSON.stringify(audit)).not.toContain("private@example.invalid");
    } finally {
      await db.redemptionOrder.deleteMany({ where: { giftId: gift.id } });
      await db.gift.delete({ where: { id: gift.id } });
    }
  });

  it("returns the same safe order fields for POST, retries and GET", async () => {
    mocks.user.mockResolvedValue(users[0]);
    const input = cash();
    for (let n = 0; n < 2; n++) {
      const result = await submitOrder(request("redemptions", input.idempotencyKey, input));
      expect(result.status).toBe(201);
      const { order } = await result.json();
      expect(order.hasCashQrCode).toBe(true);
      for (const field of ["recipientPhoneEnc", "recipientAddressEnc", "cashQrCodeUrl", "fulfillmentDataEnc"]) expect(order).not.toHaveProperty(field);
    }
    const { orders } = await (await listOrders(new Request("http://localhost/api/redemptions"))).json();
    expect(orders.find((o: { idempotencyKey: string }) => o.idempotencyKey === input.idempotencyKey)).toMatchObject({ hasCashQrCode: true });
    mocks.user.mockResolvedValue(users[2]);
    const denied = await submitOrder(request("redemptions", input.idempotencyKey, input));
    expect(denied.status).toBe(409);
    expect(await denied.json()).not.toHaveProperty("order");
  });

  it("validates video ownership and original normalized URL before returning or enqueuing a retry", async () => {
    mocks.user.mockResolvedValue(users[0]);
    const idempotencyKey = key();
    const link = "https://v.kuaishou.com/OriginalClip";
    const first = await submitVideo(request("videos", idempotencyKey, { link }));
    expect(first.status).toBe(201);
    const { video } = await first.json();
    await db.videoSubmission.update({ where: { id: video.id }, data: { requestUrl: "https://www.kuaishou.com/short-video/ResolvedId" } });
    expect((await submitVideo(request("videos", idempotencyKey, { link: `这是分享文案 ${link}` }))).status).toBe(200);
    mocks.enqueue.mockClear();
    expect((await submitVideo(request("videos", idempotencyKey, { link: "https://v.kuaishou.com/OtherClip" }))).status).toBe(409);
    mocks.user.mockResolvedValue(users[2]);
    const denied = await submitVideo(request("videos", idempotencyKey, { link }));
    expect(denied.status).toBe(409);
    expect(await denied.json()).not.toHaveProperty("video");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    { member: 2, submitted: "RacingClip", status: 409 },
    { member: 0, submitted: "ChangedClip", status: 409 },
    { member: 0, submitted: "RacingClip", status: 200 },
  ])("validates the P2002 fallback for $member / $submitted", async ({ member, submitted, status }) => {
    const idempotencyKey = key();
    const link = "https://v.kuaishou.com/RacingClip";
    const first = await db.videoSubmission.create({ data: {
      userId: users[0].id, sourceUrl: link, requestUrl: link, sourceKind: "short-link", submittedNickname: "测试", idempotencyKey,
    } });
    const lookup = vi.spyOn(db.videoSubmission, "findUnique").mockResolvedValueOnce(null).mockResolvedValueOnce(first);
    const sameSource = vi.spyOn(db.videoSubmission, "findFirst").mockResolvedValueOnce(null);
    mocks.user.mockResolvedValue(users[member]);
    mocks.enqueue.mockClear();
    try {
      const response = await submitVideo(request("videos", idempotencyKey, { link: `https://v.kuaishou.com/${submitted}` }));
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(status);
      if (status === 409) {
        expect(JSON.stringify(body)).not.toContain(first.id);
        expect(mocks.enqueue).not.toHaveBeenCalled();
      } else {
        expect(body.video.id).toBe(first.id);
        expect(mocks.enqueue).toHaveBeenCalledWith(first.id);
      }
      expect(lookup).toHaveBeenCalledTimes(2);
    } finally { lookup.mockRestore(); sameSource.mockRestore(); }
  });
});

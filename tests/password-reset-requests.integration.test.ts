import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/security";
import { createPasswordResetRequest, listPendingPasswordResetRequests, reviewPasswordResetRequest } from "@/lib/password-reset-requests";

const enabled = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("密码找回申诉", () => {
  const ids: string[] = [];
  let memberId = "";
  let reviewerId = "";
  let reviewerTargetId = "";

  beforeAll(async () => {
    const suffix = Date.now().toString();
    const [member, reviewer, reviewerTarget] = await Promise.all([
      db.user.create({ data: { kuaishouId: `reset-member-${suffix}`, nickname: "找回成员", passwordHash: await hashPassword("old-password"), account: { create: { balance: 0 } } } }),
      db.user.create({ data: { kuaishouId: `reset-reviewer-${suffix}`, nickname: "审核员", passwordHash: await hashPassword("reviewer-password"), role: "REVIEWER", account: { create: { balance: 0 } } } }),
      db.user.create({ data: { kuaishouId: `reset-reviewer-target-${suffix}`, nickname: "审核员目标", passwordHash: await hashPassword("target-password"), role: "REVIEWER", account: { create: { balance: 0 } } } }),
    ]);
    memberId = member.id;
    reviewerId = reviewer.id;
    reviewerTargetId = reviewerTarget.id;
    ids.push(memberId, reviewerId, reviewerTargetId);
  });

  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await db.passwordResetRequest.deleteMany({ where: { userId: { in: ids } } });
    await db.session.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  });

  it("stores only a hash and approves the member password transactionally", async () => {
    const newPassword = "new-password";
    const memberKuaishouId = (await db.user.findUniqueOrThrow({ where: { id: memberId } })).kuaishouId;
    await db.session.create({ data: { id: "reset-session", userId: memberId, expiresAt: new Date(Date.now() + 3600_000) } });
    await createPasswordResetRequest({ kuaishouId: memberKuaishouId.toUpperCase(), proposedPasswordHash: await hashPassword(newPassword), ip: "198.51.100.3", requestId: "create-reset" });
    const pending = await listPendingPasswordResetRequests();
    const request = pending.find((item) => item.user.nickname === "找回成员");
    expect(request).toBeTruthy();
    expect(JSON.stringify(request)).not.toContain("new-password");
    expect(JSON.stringify(request)).not.toContain(memberKuaishouId);
    await reviewPasswordResetRequest({ requestId: request!.id, action: "APPROVE", approver: { id: reviewerId, role: "REVIEWER" }, ip: "198.51.100.4", auditRequestId: "approve-reset" });
    const updated = await db.user.findUniqueOrThrow({ where: { id: memberId } });
    expect(await verifyPassword(updated.passwordHash, newPassword)).toBe(true);
    expect(await db.session.count({ where: { userId: memberId } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "PASSWORD_RESET_APPROVED", actorId: reviewerId } })).toBe(1);
  });

  it("does not let a reviewer approve another reviewer password reset", async () => {
    await createPasswordResetRequest({ kuaishouId: (await db.user.findUniqueOrThrow({ where: { id: reviewerTargetId } })).kuaishouId, proposedPasswordHash: await hashPassword("new-target-password"), ip: "198.51.100.5", requestId: "reviewer-target" });
    const request = (await listPendingPasswordResetRequests()).find((item) => item.user.nickname === "审核员目标");
    await expect(reviewPasswordResetRequest({ requestId: request!.id, action: "APPROVE", approver: { id: reviewerId, role: "REVIEWER" }, ip: "198.51.100.6", auditRequestId: "blocked" })).rejects.toThrow("审核员不能处理其他审核员或管理员的申请");
  });
});

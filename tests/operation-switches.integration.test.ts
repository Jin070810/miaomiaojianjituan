import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getOperationSwitches, updateOperationSwitch } from "@/lib/operation-switches";

const enabled = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("运营开关", () => {
  let adminId = "";

  beforeAll(async () => {
    const user = await db.user.create({
      data: { kuaishouId: `switch-admin-${Date.now()}`, nickname: "开关管理员", passwordHash: "test", role: "ADMIN", account: { create: { balance: 0 } } },
    });
    adminId = user.id;
  });

  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { entity: "SystemSetting", actorId: adminId } });
    await db.systemSetting.updateMany({ data: { enabled: true, updatedById: null } });
    await db.user.delete({ where: { id: adminId } });
    await db.$disconnect();
  });

  it("updates a switch transactionally and exposes the new state", async () => {
    const updated = await updateOperationSwitch({ key: "VIDEO_SUBMISSIONS", enabled: false, actorId: adminId, requestId: "switch-test" });
    expect(updated.enabled).toBe(false);
    expect((await getOperationSwitches()).find((row) => row.key === "VIDEO_SUBMISSIONS")?.enabled).toBe(false);
    expect(await db.auditLog.count({ where: { entity: "SystemSetting", entityId: "VIDEO_SUBMISSIONS", actorId: adminId } })).toBe(1);
  });
});

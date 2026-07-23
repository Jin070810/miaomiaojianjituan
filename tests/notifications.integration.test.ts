import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  createAnnouncementDraft,
  publishAnnouncement,
  withdrawAnnouncement,
} from "@/lib/notifications";

const enabled = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("通知与公告事务", () => {
  let adminId = "";
  let memberId = "";
  let selectedMemberId = "";
  let announcementId = "";

  beforeAll(async () => {
    const suffix = Date.now().toString();
    const admin = await db.user.create({
      data: { kuaishouId: `notice-admin-${suffix}`, nickname: "通知管理员", passwordHash: "test", role: "ADMIN" },
    });
    const member = await db.user.create({
      data: { kuaishouId: `notice-member-${suffix}`, nickname: "通知成员", passwordHash: "test", role: "MEMBER", active: true },
    });
    const selected = await db.user.create({
      data: { kuaishouId: `notice-selected-${suffix}`, nickname: "定向成员", passwordHash: "test", role: "MEMBER", active: true },
    });
    adminId = admin.id;
    memberId = member.id;
    selectedMemberId = selected.id;
  });

  afterAll(async () => {
    await db.notification.deleteMany({ where: { userId: { in: [memberId, selectedMemberId] } } });
    if (announcementId) {
      await db.announcementRecipient.deleteMany({ where: { announcementId } });
      await db.announcement.deleteMany({ where: { id: announcementId } });
    }
    await db.user.deleteMany({ where: { id: { in: [adminId, memberId, selectedMemberId] } } });
    await db.$disconnect();
  });

  it("publishes selected announcements once and withdraws unread copies", async () => {
    const draft = await createAnnouncementDraft({
      actorId: adminId,
      title: "定向测试公告",
      content: "第一行\n第二行",
      audience: "SELECTED",
      recipientIds: [memberId],
    });
    announcementId = draft.id;
    await publishAnnouncement({ announcementId, actorId: adminId });
    await publishAnnouncement({ announcementId, actorId: adminId });

    expect(await db.notification.count({ where: { announcementId, userId: memberId } })).toBe(1);
    expect(await db.notification.count({ where: { announcementId, userId: selectedMemberId } })).toBe(0);
    expect((await db.notification.findFirstOrThrow({ where: { announcementId } })).body).toContain("第二行");

    await withdrawAnnouncement({ announcementId, actorId: adminId });
    expect(await db.notification.count({ where: { announcementId, readAt: { not: null } } })).toBe(1);
  });
});

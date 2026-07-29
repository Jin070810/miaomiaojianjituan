import { AnnouncementAudience, NotificationType, Prisma } from "@prisma/client";
import { db } from "./db";
import { memberParticipantRoles } from "./member-roles";

type Transaction = Prisma.TransactionClient;

export type NotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  dedupeKey: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  announcementId?: string;
};

export async function createNotification(tx: Transaction, input: NotificationInput) {
  return tx.notification.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: input,
    update: {},
  });
}

export async function createNotifications(tx: Transaction, inputs: NotificationInput[]) {
  if (inputs.length === 0) return { count: 0 };
  return tx.notification.createMany({ data: inputs, skipDuplicates: true });
}

async function validateSelectedRecipients(tx: Transaction, userIds: string[]) {
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0 || uniqueIds.length > 200) {
    throw new Error("定向公告需要选择 1 至 200 名成员");
  }
  const users = await tx.user.findMany({
    where: { id: { in: uniqueIds }, active: true, role: { in: memberParticipantRoles } },
    select: { id: true },
  });
  if (users.length !== uniqueIds.length) throw new Error("公告收件人包含不存在、停用或非普通成员账号");
  return users.map((user) => user.id);
}

export async function createAnnouncementDraft(input: {
  actorId: string;
  title: string;
  content: string;
  audience: AnnouncementAudience;
  recipientIds?: string[];
  ip?: string;
}) {
  return db.$transaction(async (tx) => {
    const recipientIds = input.audience === "SELECTED"
      ? await validateSelectedRecipients(tx, input.recipientIds ?? [])
      : [];
    const announcement = await tx.announcement.create({
      data: {
        title: input.title,
        content: input.content,
        audience: input.audience,
        createdById: input.actorId,
        recipients: recipientIds.length
          ? { createMany: { data: recipientIds.map((userId) => ({ userId })) } }
          : undefined,
      },
      include: { recipients: { select: { userId: true } } },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "ANNOUNCEMENT_DRAFT_CREATED",
        entity: "Announcement",
        entityId: announcement.id,
        afterValue: { title: announcement.title, audience: announcement.audience, recipientCount: recipientIds.length },
        ip: input.ip,
      },
    });
    return announcement;
  });
}

export async function updateAnnouncementDraft(input: {
  announcementId: string;
  actorId: string;
  title: string;
  content: string;
  audience: AnnouncementAudience;
  recipientIds?: string[];
  ip?: string;
}) {
  return db.$transaction(async (tx) => {
    const before = await tx.announcement.findUnique({ where: { id: input.announcementId } });
    if (!before) throw new Error("公告不存在");
    if (before.status !== "DRAFT") throw new Error("只有草稿公告可以编辑");
    const recipientIds = input.audience === "SELECTED"
      ? await validateSelectedRecipients(tx, input.recipientIds ?? [])
      : [];
    await tx.announcementRecipient.deleteMany({ where: { announcementId: before.id } });
    const updated = await tx.announcement.update({
      where: { id: before.id },
      data: {
        title: input.title,
        content: input.content,
        audience: input.audience,
        recipients: recipientIds.length
          ? { createMany: { data: recipientIds.map((userId) => ({ userId })) } }
          : undefined,
      },
      include: { recipients: { select: { userId: true } } },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "ANNOUNCEMENT_DRAFT_UPDATED",
        entity: "Announcement",
        entityId: updated.id,
        beforeValue: { title: before.title, audience: before.audience },
        afterValue: { title: updated.title, audience: updated.audience, recipientCount: recipientIds.length },
        ip: input.ip,
      },
    });
    return updated;
  });
}

export async function publishAnnouncement(input: { announcementId: string; actorId: string; ip?: string }) {
  return db.$transaction(async (tx) => {
    const announcement = await tx.announcement.findUnique({
      where: { id: input.announcementId },
      include: { recipients: { select: { userId: true } } },
    });
    if (!announcement) throw new Error("公告不存在");
    if (announcement.status === "PUBLISHED") return announcement;
    if (announcement.status !== "DRAFT") throw new Error("当前公告不能发布");

    const recipientIds = announcement.audience === "ALL"
      ? await tx.user.findMany({ where: { active: true, role: { in: memberParticipantRoles } }, select: { id: true } }).then((rows) => rows.map((row) => row.id))
      : await validateSelectedRecipients(tx, announcement.recipients.map((recipient) => recipient.userId));
    const publishedAt = new Date();
    const claimed = await tx.announcement.updateMany({
      where: { id: announcement.id, status: "DRAFT" },
      data: { status: "PUBLISHED", publishedAt },
    });
    if (claimed.count !== 1) throw new Error("公告状态已变化，请刷新后重试");
    await createNotifications(tx, recipientIds.map((userId) => ({
      userId,
      type: "ANNOUNCEMENT",
      title: announcement.title,
      body: announcement.content,
      entityType: "Announcement",
      entityId: announcement.id,
      announcementId: announcement.id,
      dedupeKey: `announcement:${announcement.id}:${userId}`,
    })));
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "ANNOUNCEMENT_PUBLISHED",
        entity: "Announcement",
        entityId: announcement.id,
        afterValue: { audience: announcement.audience, recipientCount: recipientIds.length, publishedAt: publishedAt.toISOString() },
        ip: input.ip,
      },
    });
    return { ...announcement, status: "PUBLISHED" as const, publishedAt };
  });
}

export async function withdrawAnnouncement(input: { announcementId: string; actorId: string; ip?: string }) {
  return db.$transaction(async (tx) => {
    const announcement = await tx.announcement.findUnique({ where: { id: input.announcementId } });
    if (!announcement) throw new Error("公告不存在");
    if (announcement.status === "WITHDRAWN") return announcement;
    if (announcement.status !== "PUBLISHED") throw new Error("只有已发布公告可以撤回");
    const withdrawnAt = new Date();
    await tx.announcement.update({ where: { id: announcement.id }, data: { status: "WITHDRAWN", withdrawnAt } });
    await tx.notification.updateMany({
      where: { announcementId: announcement.id, readAt: null },
      data: { readAt: withdrawnAt },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "ANNOUNCEMENT_WITHDRAWN",
        entity: "Announcement",
        entityId: announcement.id,
        beforeValue: { status: announcement.status },
        afterValue: { status: "WITHDRAWN", withdrawnAt: withdrawnAt.toISOString() },
        ip: input.ip,
      },
    });
    return { ...announcement, status: "WITHDRAWN" as const, withdrawnAt };
  });
}

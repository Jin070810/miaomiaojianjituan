import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { softDeleteAdminGift } from "@/lib/admin-gifts";
import { db } from "@/lib/db";
import {
  giftCategorySchema,
  giftImageValueSchema,
  giftKindSchema,
  giftTagsSchema,
  giftValidationErrorMessage,
  inferGiftCategory,
  inferGiftTags,
  membershipFieldsSchema,
  normalizeGiftTags,
  parseMembershipFields,
} from "@/lib/gifts";
import { assertSameOrigin, getClientIp } from "@/lib/security";

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: giftKindSchema.optional(),
  category: giftCategorySchema.optional(),
  tags: giftTagsSchema.optional(),
  fulfillmentFields: membershipFieldsSchema.nullable().optional(),
  pointsCost: z.number().int().positive().max(10_000_000).optional(),
  stock: z.number().int().min(0).max(1_000_000).optional(),
  imageUrl: giftImageValueSchema,
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const { imageUrl: auditImageUrl, fulfillmentFields: _ignoredFields, ...auditInput } = input;
    const gift = await db.$transaction(async (tx) => {
      const before = await tx.gift.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new Error("礼品不存在");
      if (input.kind && input.kind !== before.kind) {
        const [orderCount, awardCount] = await Promise.all([
          tx.redemptionOrder.count({ where: { giftId: id } }),
          tx.rankingAward.count({ where: { giftId: id } }),
        ]);
        if (orderCount > 0 || awardCount > 0) {
          throw new Error("已有兑换或榜单奖励引用该礼品，不能修改礼品类型");
        }
      }
      const nextKind = input.kind ?? before.kind;
      const nextName = input.name ?? before.name;
      const category = input.category
        ?? ((input.name !== undefined || input.kind !== undefined) ? inferGiftCategory(nextName, nextKind) : before.category);
      const requestedTags = input.tags ?? before.tags;
      const tags = input.tags !== undefined
        ? normalizeGiftTags(category, nextKind, input.tags)
        : (input.name !== undefined || input.kind !== undefined || input.category !== undefined)
          ? inferGiftTags(nextName, nextKind, category)
          : normalizeGiftTags(category, nextKind, requestedTags);
      const fulfillmentFields = nextKind === "MEMBERSHIP"
        ? (input.fulfillmentFields === undefined ? parseMembershipFields(before.fulfillmentFields) : (input.fulfillmentFields ?? []))
        : [];
      const updated = await tx.gift.update({
        where: { id },
        data: {
          ...input,
          category,
          tags,
          fulfillmentFields: nextKind === "MEMBERSHIP" ? fulfillmentFields : Prisma.JsonNull,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "GIFT_UPDATED",
          entity: "Gift",
          entityId: id,
          beforeValue: { name: before.name, kind: before.kind, pointsCost: before.pointsCost, stock: before.stock, active: before.active, pinned: before.pinned },
          afterValue: {
            ...auditInput,
            category,
            tags,
            fulfillmentFieldCount: fulfillmentFields.length,
            ...(auditImageUrl === undefined ? {} : { imageConfigured: Boolean(auditImageUrl) }),
          },
          ip: getClientIp(request),
        },
      });
      return updated;
    });
    return NextResponse.json({ gift });
  } catch (error) {
    if (error instanceof Error && error.message === "礼品不存在") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: error instanceof z.ZodError ? giftValidationErrorMessage(error) : error instanceof Error ? error.message : "更新失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    await softDeleteAdminGift({ giftId: id, actorId: admin.id, ip: getClientIp(request) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除失败";
    return NextResponse.json({ error: message }, { status: message === "礼品不存在" ? 404 : 400 });
  }
}

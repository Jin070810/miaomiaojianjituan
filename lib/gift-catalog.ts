import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { paginationResult } from "./pagination";
import { withPublicGiftImage } from "./public-images";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  take: z.coerce.number().int().min(1).max(50).default(24),
  category: z.string().trim().min(1).max(20).optional(),
  sort: z.enum(["featured", "sales", "priceAsc", "priceDesc"]).default("featured"),
});
const stableOrder = [{ pinned: "desc" }, { displayOrder: "asc" }, { createdAt: "desc" }, { id: "asc" }] satisfies Prisma.GiftOrderByWithRelationInput[];

export async function getPublicGiftCatalog(url: URL) {
  const input = querySchema.parse(Object.fromEntries(url.searchParams));
  // Preserve no-parameter legacy clients during rollout; new clients request pages.
  const paged = ["page", "take", "category", "sort"].some((key) => url.searchParams.has(key));
  const where: Prisma.GiftWhereInput = { active: true, deletedAt: null, ...(input.category ? { category: input.category } : {}) };
  const skip = (input.page - 1) * input.take;
  const [total, categories] = await Promise.all([
    db.gift.count({ where }),
    db.gift.groupBy({ by: ["category"], where: { active: true, deletedAt: null }, orderBy: { category: "asc" } }),
  ]);
  let gifts;
  let salesById: Map<string, number> | undefined;
  if (input.sort === "sales") {
    const selected = await db.$queryRaw<{ id: string; salesCount: bigint }[]>(Prisma.sql`
      SELECT g."id", COALESCE(s.sold, 0)::bigint AS "salesCount" FROM "Gift" g
      LEFT JOIN (
        SELECT "giftId", SUM("quantity") AS sold FROM "RedemptionOrder"
        WHERE "status" NOT IN ('REJECTED', 'REFUNDED') GROUP BY "giftId"
      ) s ON s."giftId" = g."id"
      WHERE g."active" = TRUE AND g."deletedAt" IS NULL
        ${input.category ? Prisma.sql`AND g."category" = ${input.category}` : Prisma.empty}
      ORDER BY COALESCE(s.sold, 0) DESC, g."pinned" DESC, g."displayOrder" ASC, g."createdAt" DESC, g."id" ASC
      LIMIT ${input.take} OFFSET ${skip}`);
    const fetched = await db.gift.findMany({ where: { ...where, id: { in: selected.map((row) => row.id) } } });
    const byId = new Map(fetched.map((gift) => [gift.id, gift]));
    gifts = selected.flatMap((row) => { const gift = byId.get(row.id); return gift ? [gift] : []; });
    salesById = new Map(selected.map((row) => [row.id, Number(row.salesCount)]));
  } else {
    const orderBy: Prisma.GiftOrderByWithRelationInput[] = input.sort === "featured" ? stableOrder : [{ pointsCost: input.sort === "priceAsc" ? "asc" : "desc" }, ...stableOrder];
    gifts = await db.gift.findMany({ where, orderBy, ...(paged ? { skip, take: input.take } : {}) });
  }
  const sales = !salesById && gifts.length ? await db.redemptionOrder.groupBy({
    by: ["giftId"], where: { giftId: { in: gifts.map((gift) => gift.id) }, status: { notIn: ["REJECTED", "REFUNDED"] } }, _sum: { quantity: true },
  }) : [];
  salesById ??= new Map(sales.map((row) => [row.giftId, row._sum.quantity ?? 0]));
  return {
    gifts: gifts.map((gift) => ({ ...withPublicGiftImage(gift), salesCount: salesById.get(gift.id) ?? 0 })),
    categories: categories.map((row) => row.category),
    pagination: paginationResult(paged ? input.page : 1, paged ? input.take : Math.max(1, total), total),
  };
}

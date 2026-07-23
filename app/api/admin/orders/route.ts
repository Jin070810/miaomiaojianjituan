import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePagination, paginationResult } from "@/lib/pagination";

const orderStatuses = ["PENDING", "APPROVED", "FULFILLED", "REJECTED", "REFUNDED"] as const;

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const { page, take, skip } = parsePagination(url, 50, 100);
    const search = url.searchParams.get("search")?.trim();
    const requestedStatus = url.searchParams.get("status");
    const status = orderStatuses.find((value) => value === requestedStatus);
    const where = {
      ...(status ? { status } : {}),
      ...(search ? {
        OR: [
          { id: { contains: search, mode: "insensitive" as const } },
          { gift: { is: { name: { contains: search, mode: "insensitive" as const } } } },
          { user: { is: { kuaishouId: { contains: search, mode: "insensitive" as const } } } },
          { user: { is: { nickname: { contains: search, mode: "insensitive" as const } } } },
        ],
      } : {}),
    };
    const [orders, total] = await Promise.all([
      db.redemptionOrder.findMany({
        where,
        include: { gift: true, user: { select: { kuaishouId: true, nickname: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      db.redemptionOrder.count({ where }),
    ]);
    return NextResponse.json({
      orders: orders.map(({ recipientPhoneEnc, recipientAddressEnc, cashQrCodeUrl, ...order }) => ({
        ...order,
        hasRecipientName: Boolean(order.recipientName),
        hasRecipientPhone: Boolean(recipientPhoneEnc),
        hasRecipientAddress: Boolean(recipientAddressEnc),
        hasCashQrCode: Boolean(cashQrCodeUrl),
      })),
      pagination: paginationResult(page, take, total),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

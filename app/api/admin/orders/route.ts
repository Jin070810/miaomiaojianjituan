import { NextResponse } from "next/server";
import { RedemptionStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePagination, paginationResult } from "@/lib/pagination";

const orderStatuses = ["PENDING", "APPROVED", "PENDING_SHIPMENT", "FULFILLED", "REJECTED", "REFUNDED"] as const;

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const { page, take, skip } = parsePagination(url, 50, 100);
    const search = url.searchParams.get("search")?.trim();
    const requestedStatus = url.searchParams.get("status");
    const status = orderStatuses.find((value) => value === requestedStatus);
    const searchWhere = search ? {
      OR: [
        { id: { contains: search, mode: "insensitive" as const } },
        { gift: { is: { name: { contains: search, mode: "insensitive" as const } } } },
        { user: { is: { kuaishouId: { contains: search, mode: "insensitive" as const } } } },
        { user: { is: { nickname: { contains: search, mode: "insensitive" as const } } } },
      ],
    } : {};
    const where = {
      ...searchWhere,
      ...(status === "PENDING_SHIPMENT"
        ? { status: { in: [RedemptionStatus.PENDING, RedemptionStatus.APPROVED] } }
        : status ? { status } : {}),
    };
    const [orders, total, statusGroups] = await Promise.all([
      db.redemptionOrder.findMany({
        where,
        include: { gift: true, user: { select: { kuaishouId: true, nickname: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      db.redemptionOrder.count({ where }),
      db.redemptionOrder.groupBy({ by: ["status"], where: searchWhere, _count: { _all: true } }),
    ]);
    const statusCount = new Map(statusGroups.map((row) => [row.status, row._count._all]));
    const all = [...statusCount.values()].reduce((sum, count) => sum + count, 0);
    return NextResponse.json({
      orders: orders.map(({ recipientPhoneEnc, recipientAddressEnc, cashQrCodeUrl, fulfillmentDataEnc, ...order }) => ({
        ...order,
        fulfilledAt: order.fulfilledAt ?? (order.status === "FULFILLED" ? order.reviewedAt : null),
        hasRecipientName: Boolean(order.recipientName),
        hasRecipientPhone: Boolean(recipientPhoneEnc),
        hasRecipientAddress: Boolean(recipientAddressEnc),
        hasCashQrCode: Boolean(cashQrCodeUrl),
        hasFulfillmentData: Boolean(fulfillmentDataEnc),
      })),
      pagination: paginationResult(page, take, total),
      statusCounts: {
        all,
        pending: (statusCount.get(RedemptionStatus.PENDING) ?? 0) + (statusCount.get(RedemptionStatus.APPROVED) ?? 0),
        fulfilled: statusCount.get(RedemptionStatus.FULFILLED) ?? 0,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

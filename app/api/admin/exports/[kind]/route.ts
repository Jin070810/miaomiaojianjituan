import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { presentAuditLog } from "@/lib/audit";
import { maskedIp, toCsv } from "@/lib/csv";
import { assertSameOrigin, getClientIp, requestId } from "@/lib/security";
import { writeAuditLog } from "@/lib/audit";

const kinds = ["orders", "points", "videos", "audit"] as const;
type ExportKind = typeof kinds[number];

function dateRange(url: URL) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const validFrom = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : null;
  const validTo = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : null;
  return validFrom || validTo
    ? { ...(validFrom ? { gte: validFrom } : {}), ...(validTo ? { lte: validTo } : {}) }
    : null;
}

function filename(kind: ExportKind) {
  return ({
    orders: "orders",
    points: "points",
    videos: "videos",
    audit: "audit-logs",
  })[kind];
}

export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { kind: rawKind } = await context.params;
    if (!kinds.includes(rawKind as ExportKind)) return NextResponse.json({ error: "导出类型不支持" }, { status: 404 });
    const kind = rawKind as ExportKind;
    const range = dateRange(new URL(request.url));
    const take = 50_001;
    let headers: string[] = [];
    let rows: Array<Array<unknown>> = [];

    if (kind === "orders") {
      const records = await db.redemptionOrder.findMany({
        where: range ? { createdAt: range } : undefined,
        take,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { gift: { select: { name: true, kind: true } }, user: { select: { nickname: true, kuaishouId: true } } },
      });
      headers = ["订单 ID", "成员昵称", "快手 ID", "礼品", "礼品类型", "状态", "数量", "积分", "快递单号", "发放时间", "创建时间"];
      rows = records.map((row) => [
        row.id, row.user.nickname, row.user.kuaishouId, row.gift.name, row.gift.kind, row.status, row.quantity, row.totalCost,
        row.trackingNumber, row.fulfilledAt ?? (row.status === "FULFILLED" ? row.reviewedAt : null), row.createdAt.toISOString(),
      ]);
    } else if (kind === "points") {
      const records = await db.pointLedger.findMany({
        where: range ? { createdAt: range } : undefined,
        take,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { account: { include: { user: { select: { nickname: true, kuaishouId: true } } } } },
      });
      headers = ["流水 ID", "成员昵称", "快手 ID", "类型", "变动积分", "变动后余额", "关联对象", "备注", "时间"];
      rows = records.map((row) => [
        row.id, row.account.user.nickname, row.account.user.kuaishouId, row.type, row.amount, row.balanceAfter,
        row.referenceId, row.note, row.createdAt.toISOString(),
      ]);
    } else if (kind === "videos") {
      const records = await db.videoSubmission.findMany({
        where: range ? { submittedAt: range } : undefined,
        take,
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        include: { user: { select: { nickname: true, kuaishouId: true } } },
      });
      headers = ["视频 ID", "成员昵称", "快手 ID", "视频链接", "photoId", "抓取作者", "状态", "点赞", "积分", "结果说明", "提交时间"];
      rows = records.map((row) => [
        row.id, row.user.nickname, row.user.kuaishouId, row.sourceUrl, row.photoId, row.fetchedOwner, row.status,
        row.likes, row.points, row.reviewReason, row.submittedAt.toISOString(),
      ]);
    } else {
      const records = await db.auditLog.findMany({
        where: range ? { createdAt: range } : undefined,
        take,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { actor: { select: { nickname: true, kuaishouId: true, role: true } } },
      });
      headers = ["日志 ID", "动作", "动作中文", "对象", "对象 ID", "摘要", "操作者", "快手 ID", "角色", "原因", "IP（脱敏）", "请求 ID", "时间"];
      rows = records.map((record) => {
        const presented = presentAuditLog(record);
        return [
          record.id, record.action, presented.actionLabel, presented.entityLabel, record.entityId, presented.summary,
          record.actor?.nickname ?? "系统自动任务", record.actor?.kuaishouId, record.actor?.role, record.reason,
          maskedIp(record.ip), record.requestId, record.createdAt.toISOString(),
        ];
      });
    }

    if (rows.length >= take) return NextResponse.json({ error: "导出数据超过 50000 条，请缩小日期范围后重试" }, { status: 413 });
    await writeAuditLog(db, {
      actorId: admin.id,
      action: "ADMIN_CSV_EXPORTED",
      entity: "DataExport",
      entityId: kind,
      afterValue: { kind, count: rows.length },
      ip: getClientIp(request),
      requestId: requestId(),
    });
    return new NextResponse(toCsv(headers, rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`miaomiao-${filename(kind)}.csv`)}`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "导出失败" }, { status: 403 });
  }
}

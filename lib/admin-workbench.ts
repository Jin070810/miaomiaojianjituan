import { db } from "./db";
import { presentAuditLog } from "./audit";
import { memberParticipantRoles } from "./member-roles";
import { getOperationSwitches } from "./operation-switches";
import { periodBounds } from "./rankings";

export const ADMIN_WORKBENCH_RANGES = ["7d", "30d"] as const;
export type AdminWorkbenchRange = (typeof ADMIN_WORKBENCH_RANGES)[number];

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function shanghaiDate(year: number, month: number, date: number) {
  return new Date(Date.UTC(year, month, date) - SHANGHAI_OFFSET_MS);
}

function shanghaiDateKey(value: Date) {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function dayRange(reference: Date, days: number) {
  const shifted = new Date(reference.getTime() + SHANGHAI_OFFSET_MS);
  return {
    start: shanghaiDate(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - (days - 1)),
    end: new Date(reference.getTime()),
  };
}

export function parseWorkbenchRange(value: string | null): AdminWorkbenchRange {
  return ADMIN_WORKBENCH_RANGES.includes(value as AdminWorkbenchRange) ? value as AdminWorkbenchRange : "7d";
}

export async function getAdminWorkbench(range: AdminWorkbenchRange, reference = new Date()) {
  const days = range === "30d" ? 30 : 7;
  const window = dayRange(reference, days);
  const currentWeek = periodBounds("week", reference);
  const [
    activeMembers,
    approvedVideos,
    ledger,
    createdOrders,
    fulfilledOrders,
    pendingAppeals,
    pendingOrders,
    pendingPasswordResets,
    failedChallenges,
    lowStockGifts,
    videos,
    ledgerRows,
    fulfilledRows,
    switches,
  ] = await Promise.all([
    db.user.count({ where: { active: true, role: { in: memberParticipantRoles } } }),
    db.videoSubmission.aggregate({
      where: { status: "APPROVED", submittedAt: { gte: window.start, lt: window.end } },
      _count: { id: true },
      _sum: { likes: true, points: true },
    }),
    db.pointLedger.aggregate({
      where: { createdAt: { gte: window.start, lt: window.end } },
      _sum: { amount: true },
    }),
    db.redemptionOrder.count({ where: { createdAt: { gte: window.start, lt: window.end } } }),
    db.redemptionOrder.count({ where: { status: "FULFILLED", fulfilledAt: { gte: window.start, lt: window.end } } }),
    db.videoAppeal.count({ where: { status: "PENDING" } }),
    db.redemptionOrder.count({ where: { status: { in: ["PENDING", "APPROVED"] } } }),
    db.passwordResetRequest.count({ where: { status: "PENDING", expiresAt: { gt: reference } } }),
    db.weeklyChallengePeriod.count({ where: { status: "FAILED" } }),
    db.gift.count({ where: { active: true, deletedAt: null, stock: { lte: 3 } } }),
    db.videoSubmission.findMany({
      where: { status: "APPROVED", submittedAt: { gte: window.start, lt: window.end } },
      select: { submittedAt: true, likes: true, points: true },
    }),
    db.pointLedger.findMany({
      where: { createdAt: { gte: window.start, lt: window.end }, type: { in: ["VIDEO_REWARD", "REDEMPTION_REFUND"] } },
      select: { createdAt: true, type: true, amount: true },
    }),
    db.redemptionOrder.findMany({
      where: { status: "FULFILLED", fulfilledAt: { gte: window.start, lt: window.end } },
      select: { fulfilledAt: true },
    }),
    getOperationSwitches(),
  ]);

  const daysInRange = Array.from({ length: days }, (_, index) => {
    const start = new Date(window.start.getTime() + index * 86_400_000);
    const key = shanghaiDateKey(start);
    const [, month, date] = key.split("-");
    return { key, label: `${Number(month)}/${Number(date)}` };
  });
  const sumByDay = <T extends { createdAt?: Date | null; submittedAt?: Date | null; fulfilledAt?: Date | null }>(rows: T[], key: string, select: (row: T) => number) => rows
    .filter((row) => shanghaiDateKey(row.createdAt ?? row.submittedAt ?? row.fulfilledAt ?? reference) === key)
    .reduce((total, row) => total + select(row), 0);
  const disabledSwitches = switches.filter((item) => !item.enabled);
  const weekRows = await db.videoSubmission.findMany({
    where: { submittedAt: { gte: currentWeek.start, lt: reference }, user: { active: true, role: { in: memberParticipantRoles } } },
    select: { userId: true, status: true },
  });
  const approvedWeekRows = weekRows.filter((row) => row.status === "APPROVED");

  return {
    generatedAt: reference,
    timezone: "Asia/Shanghai",
    range,
    metrics: {
      activeMembers,
      approvedVideos: approvedVideos._count.id,
      approvedLikes: approvedVideos._sum.likes ?? 0,
      videoPoints: approvedVideos._sum.points ?? 0,
      netPointChange: ledger._sum.amount ?? 0,
      createdOrders,
      fulfilledOrders,
      lowStockGifts,
      currentWeek: {
        submitters: new Set(weekRows.map((row) => row.userId)).size,
        approvedSubmitters: new Set(approvedWeekRows.map((row) => row.userId)).size,
        approvedVideos: approvedWeekRows.length,
      },
    },
    queues: [
      { id: "appeals", label: "待复查申诉", count: pendingAppeals, section: "videos", filter: "appeals", tone: "warning" },
      { id: "orders", label: "待履约订单", count: pendingOrders, section: "orders", filter: "PENDING_SHIPMENT", tone: "warning" },
      { id: "password-resets", label: "密码找回申请", count: pendingPasswordResets, href: "/password-support", tone: "neutral" },
      { id: "challenge-failures", label: "失败的周挑战", count: failedChallenges, section: "challenges", filter: "FAILED", tone: "danger" },
      { id: "disabled-switches", label: "已关闭运营入口", count: disabledSwitches.length, section: "settings", filter: "disabled", tone: disabledSwitches.length ? "danger" : "success" },
    ],
    trends: daysInRange.map((day) => ({
      ...day,
      approvedVideos: sumByDay(videos, day.key, () => 1),
      videoPoints: sumByDay(videos, day.key, (row) => row.points ?? 0),
      refunds: sumByDay(ledgerRows.filter((row) => row.type === "REDEMPTION_REFUND"), day.key, (row) => row.amount),
      fulfilledOrders: sumByDay(fulfilledRows, day.key, () => 1),
    })),
    risks: {
      lowStockGifts,
      disabledSwitches: disabledSwitches.map((item) => ({ key: item.key, label: item.label })),
    },
  };
}

const SEARCH_LIMIT = 6;
const videoSearchStatusLabels: Record<string, string> = { APPROVED: "已到账", REJECTED: "已驳回", REVOKED: "已撤销", FAILED: "抓取失败", PROCESSING: "处理中", PENDING_REVIEW: "待审核" };
const orderSearchStatusLabels: Record<string, string> = { PENDING: "待处理", APPROVED: "待履约", FULFILLED: "已履约", REJECTED: "已驳回", REFUNDED: "已退款" };
const searchDate = (value: Date) => new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).format(value);

export async function searchAdminRecords(query: string) {
  const value = query.trim();
  if (!value) return { query: value, groups: [] };
  const contains = { contains: value, mode: "insensitive" as const };
  const [users, videos, orders, gifts] = await Promise.all([
    db.user.findMany({
      where: { OR: [{ nickname: contains }, { kuaishouId: contains }] },
      select: { id: true, nickname: true, kuaishouId: true, active: true, role: true },
      orderBy: { updatedAt: "desc" }, take: SEARCH_LIMIT,
    }),
    db.videoSubmission.findMany({
      where: { OR: [{ photoId: contains }, { user: { is: { nickname: contains } } }, { user: { is: { kuaishouId: contains } } }] },
      select: { id: true, photoId: true, status: true, submittedAt: true, user: { select: { nickname: true, kuaishouId: true } } },
      orderBy: { submittedAt: "desc" }, take: SEARCH_LIMIT,
    }),
    db.redemptionOrder.findMany({
      where: { OR: [{ id: contains }, { gift: { is: { name: contains } } }, { user: { is: { nickname: contains } } }, { user: { is: { kuaishouId: contains } } }] },
      select: { id: true, status: true, createdAt: true, gift: { select: { name: true } }, user: { select: { nickname: true, kuaishouId: true } } },
      orderBy: { createdAt: "desc" }, take: SEARCH_LIMIT,
    }),
    db.gift.findMany({
      where: { deletedAt: null, name: contains },
      select: { id: true, name: true, stock: true, active: true, pointsCost: true },
      orderBy: { updatedAt: "desc" }, take: SEARCH_LIMIT,
    }),
  ]);
  return {
    query: value,
    groups: [
      { id: "users", label: "成员", items: users.map((row) => ({ id: row.id, title: row.nickname, subtitle: `${row.kuaishouId} · ${row.active ? "启用" : "已停用"}`, section: "users", search: row.kuaishouId })) },
      { id: "videos", label: "视频", items: videos.map((row) => ({ id: row.id, title: row.photoId ?? "未获取 photoId", subtitle: `${row.user.nickname} · ${videoSearchStatusLabels[row.status] ?? row.status} · ${searchDate(row.submittedAt)}`, section: "videos", search: row.photoId ?? row.user.kuaishouId })) },
      { id: "orders", label: "订单", items: orders.map((row) => ({ id: row.id, title: row.gift.name, subtitle: `${row.user.nickname} · ${orderSearchStatusLabels[row.status] ?? row.status} · ${searchDate(row.createdAt)} · 尾号 ${row.id.slice(-6)}`, section: "orders", search: row.id })) },
      { id: "gifts", label: "礼品", items: gifts.map((row) => ({ id: row.id, title: row.name, subtitle: `${row.pointsCost} 积分 · 库存 ${row.stock} · ${row.active ? "在架" : "已下架"}`, section: "gifts", search: row.name })) },
    ].filter((group) => group.items.length),
  };
}

export async function getAdminEntityActivity(entity: string, entityId: string, page: number, take: number) {
  const where = { entity, entityId };
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      skip: (page - 1) * take,
      include: { actor: { select: { kuaishouId: true, nickname: true, role: true } } },
    }),
    db.auditLog.count({ where }),
  ]);
  return { activity: rows.map((row) => presentAuditLog(row)), pagination: { page, take, total, pages: Math.max(1, Math.ceil(total / take)) } };
}

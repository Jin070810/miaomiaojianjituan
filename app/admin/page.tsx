"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  FileText,
  ExternalLink,
  Gift,
  ImagePlus,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MoreHorizontal,
  PackageCheck,
  Pin,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminFetchError, buildAdminUsersPath, loadAdminSection, type AdminSection } from "./admin-loader";
import { PointsAdmin } from "./modules/points-admin";
import { WorkbenchAdmin } from "./modules/workbench";
import { AdminGlobalSearch } from "./modules/admin-search";
import { ActivityDrawer } from "./modules/activity-drawer";
import { isMemberParticipantRole } from "@/lib/member-roles";
import { canonicalKuaishouVideoUrl } from "@/lib/kuaishou-url";
import {
  DEFAULT_GIFT_CATEGORIES,
  inferGiftCategory,
  inferGiftTags,
  type GiftKindValue,
  type MembershipFieldDefinition,
  type MembershipFieldType,
} from "@/lib/gifts";

type AdminVideo = {
  id: string;
  sourceUrl: string;
  likes: number | null;
  points: number;
  status: string;
  reviewReason: string | null;
  fetchedOwner: string | null;
  submittedNickname: string;
  photoId: string | null;
  submittedAt: string;
  user: { kuaishouId: string; nickname: string };
};
type AdminAppeal = {
  id: string;
  reason: string;
  createdAt: string;
  video: AdminVideo & {
    fetchedOwner: string | null;
    submittedNickname: string;
    matchedOwner: boolean | null;
    photoId: string | null;
  };
  user: { id: string; kuaishouId: string; nickname: string };
};
type AdminSecondaryReview = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewReason: string | null;
  assignedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  reviewer: { id: string; kuaishouId: string; nickname: string; role: string } | null;
  video: AdminVideo & {
    views: number | null;
    commentCount: number | null;
    caption: string | null;
    coverUrl: string | null;
  };
};

type AdminUserRow = {
  id: string;
  kuaishouId: string;
  nickname: string;
  avatarUrl: string | null;
  guildStatus: string | null;
  role: string;
  active: boolean;
  invited: boolean;
  createdAt: string;
  account: { balance: number } | null;
  _count: { videos: number; redemptions: number };
};

type AdminGiftRow = { id: string; name: string; kind: GiftKindValue; category: string; tags: string[]; fulfillmentFields: MembershipFieldDefinition[] | null; pointsCost: number; stock: number; imageUrl: string | null; description: string | null; active: boolean; pinned: boolean; displayOrder: number; salesCount: number };
type GiftEditorInput = {
  name: string;
  kind: GiftKindValue;
  category: string;
  tags: string[];
  fulfillmentFields: MembershipFieldDefinition[];
  pointsCost: number;
  stock: number;
  imageUrl?: string | null;
  description?: string | null;
  active: boolean;
  pinned: boolean;
};
type AdminPointLedgerRow = {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
  account: { user: { id: string; kuaishouId: string; nickname: string; active: boolean } };
};
type VideoPointRule = {
  minimumLikes: number;
  fixedTierMaxLikes: number;
  fixedTierPoints: number;
  likesDivisor: number;
  maximumPoints: number;
  submissionWindowDays: number;
};
type AdminOrderRow = {
  id: string;
  totalCost: number;
  status: string;
  createdAt: string;
  fulfilledAt?: string | null;
  trackingNumber?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  recipientAddress?: string | null;
  cashQrCodeUrl?: string | null;
  hasRecipientName?: boolean;
  hasRecipientPhone?: boolean;
  hasRecipientAddress?: boolean;
  hasCashQrCode?: boolean;
  hasFulfillmentData?: boolean;
  membershipFields?: Array<{ key: string; label: string; type: string; value: string }>;
  gift: { name: string; kind: GiftKindValue; imageUrl: string | null };
  user: { kuaishouId: string; nickname: string };
};
type AdminAuditRow = {
  id: string;
  action: string;
  actionLabel: string;
  entity: string;
  entityLabel: string;
  entityId: string | null;
  summary: string;
  beforeValue: unknown;
  afterValue: unknown;
  reason: string | null;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
  actor: { kuaishouId: string; nickname: string; role: string } | null;
};
type AdminRankingAward = {
  id: string;
  rank: number;
  value: number;
  status: string;
  giftId: string | null;
  gift: { id: string; name: string; kind: GiftKindValue } | null;
  user: { kuaishouId: string; nickname: string };
  recipientName: string | null;
  recipientPhone: string | null;
  recipientAddress: string | null;
  rewardTitle?: string | null;
  rewardDescription?: string | null;
};
type AdminRankingPeriod = {
  id: string;
  type: "WEEK" | "MONTH";
  periodStart: string;
  periodEnd: string;
  status: "OPEN" | "SETTLED";
  settledAt: string | null;
  awards: AdminRankingAward[];
  preview?: Array<{ rank: number; userId: string; nickname: string; kuaishouId: string; value: number; videoCount: number; likes: number }>;
  settleable?: boolean;
};
type AdminPagination = { page: number; take: number; total: number; pages: number };
type AdminAnnouncement = {
  id: string;
  title: string;
  content: string;
  status: "DRAFT" | "PUBLISHED" | "WITHDRAWN";
  audience: "ALL" | "SELECTED";
  createdAt: string;
  publishedAt: string | null;
  withdrawnAt: string | null;
  recipients: Array<{ userId: string; user: { id: string; nickname: string; kuaishouId: string } }>;
  _count: { notifications: number };
};
type AdminWeeklyChallengePeriod = {
  id: string;
  periodStart: string;
  periodEnd: string;
  claimEndsAt: string;
  status: "GENERATING" | "READY" | "ACTIVE" | "CLOSED" | "FAILED" | "CANCELLED";
  audienceCount: number;
  personalRewardBudget: number;
  raceReward: number;
  rewardPolicyVersion: string;
  model: string;
  promptVersion: string;
  generatedAt: string | null;
  failureReason: string | null;
  _count: { assignments: number; attempts: number };
  rewardSummary: Array<{ status: string; _count: { id: number }; _sum: { rewardPoints: number | null } }>;
  taskDistribution: Array<{
    type: "VIDEO_COUNT" | "LIKE_SUM" | "COMBINED";
    _count: { id: number };
    _avg: { rewardPoints: number | null; difficultyScore: number | null };
  }>;
  raceWinner: { rewardPoints: number; wonAt: string; reversedAt: string | null; user: { nickname: string; kuaishouId: string } } | null;
};
type AdminWeeklyChallengeDetail = AdminWeeklyChallengePeriod & {
  assignments: Array<{
    id: string;
    type: "VIDEO_COUNT" | "LIKE_SUM" | "COMBINED";
    status: string;
    baselineVideoCount: number;
    baselineLikes: number;
    targetVideoCount: number | null;
    targetLikes: number | null;
    rewardPoints: number;
    rewardTiers: Array<{
      label: string;
      targetVideoCount: number | null;
      targetLikes: number | null;
      rewardPoints: number;
    }> | null;
    claimedRewardPoints: number;
    claimedTier: number;
    difficultyScore: number;
    title: string;
    aiReason: string;
    completedAt: string | null;
    claimedAt: string | null;
    progress: { videoCount: number; likes: number };
    user: { nickname: string; kuaishouId: string; active: boolean };
  }>;
  attempts: Array<{
    id: string;
    batchNumber: number;
    attemptNumber: number;
    status: string;
    model: string;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    error: string | null;
  }>;
};
type AdminMemberGrowth = {
  timezone: "Asia/Shanghai";
  generatedAt: string;
  activeMembers: number;
  currentWeek: {
    submitters: number;
    approvedSubmitters: number;
    approvedVideos: number;
    likes: number;
    videoPoints: number;
  };
  previousWeekSameWindow: {
    submitters: number;
    approvedSubmitters: number;
    approvedVideos: number;
    likes: number;
    videoPoints: number;
  };
  delta: {
    submitters: number;
    approvedSubmitters: number;
    approvedVideos: number;
    likes: number;
    videoPoints: number;
  };
  challenge: { covered: number; completed: number; claimed: number };
};
type AdminData = {
  metrics: { users: number; pendingVideos: number; pendingAppeals?: number; pendingSecondaryReviews?: number; activeGifts: number; pendingOrders: number; totalBalance: number };
  pointsTrend: Array<{ label: string; videoReward: number; adminAdjustment: number }>;
  audit: AdminAuditRow[];
  recentVideos: AdminVideo[];
  videos: AdminVideo[];
  appeals: AdminAppeal[];
  secondaryReviews: AdminSecondaryReview[];
  users: AdminUserRow[];
  pointUsers: AdminUserRow[];
  announcementUsers: AdminUserRow[];
  gifts: AdminGiftRow[];
  orders: AdminOrderRow[];
  periods: AdminRankingPeriod[];
  announcements: AdminAnnouncement[];
  weeklyChallengePeriods: AdminWeeklyChallengePeriod[];
  pointLedger: AdminPointLedgerRow[];
  pointRule: VideoPointRule;
  pointPagination: AdminPagination;
  videosPagination: AdminPagination;
  appealsPagination: AdminPagination;
  secondaryReviewsPagination: AdminPagination;
  usersPagination: AdminPagination;
  pointUsersPagination: AdminPagination;
  ordersPagination: AdminPagination;
  auditPagination: AdminPagination;
  memberGrowth: AdminMemberGrowth | null;
};

const emptyPagination: AdminPagination = { page: 1, take: 50, total: 0, pages: 1 };
const adminSections: AdminSection[] = ["workbench", "overview", "videos", "users", "points", "gifts", "orders", "rankings", "challenges", "announcements", "logs", "settings"];
const defaultPointRule: VideoPointRule = {
  minimumLikes: 200,
  fixedTierMaxLikes: 1000,
  fixedTierPoints: 50,
  likesDivisor: 2,
  maximumPoints: 5000,
  submissionWindowDays: 7,
};

function initialAdminData(dashboard: {
  metrics: AdminData["metrics"];
  pointsTrend?: AdminData["pointsTrend"];
  audit?: AdminAuditRow[];
  recentVideos?: AdminVideo[];
  memberGrowth?: AdminMemberGrowth;
}): AdminData {
  return {
    metrics: dashboard.metrics,
    pointsTrend: dashboard.pointsTrend ?? [],
    audit: dashboard.audit ?? [],
    recentVideos: dashboard.recentVideos ?? [],
    videos: [],
    appeals: [],
    secondaryReviews: [],
    users: [],
    pointUsers: [],
    announcementUsers: [],
    gifts: [],
    orders: [],
    periods: [],
    announcements: [],
    weeklyChallengePeriods: [],
    pointLedger: [],
    pointRule: defaultPointRule,
    pointPagination: emptyPagination,
    videosPagination: emptyPagination,
    appealsPagination: emptyPagination,
    secondaryReviewsPagination: emptyPagination,
    usersPagination: emptyPagination,
    pointUsersPagination: emptyPagination,
    ordersPagination: emptyPagination,
    auditPagination: { ...emptyPagination, total: dashboard.audit?.length ?? 0 },
    memberGrowth: dashboard.memberGrowth ?? null,
  };
}

function formatAdminDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatAdminToday() {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(new Date()).toUpperCase().replace(",", " ·");
}

function adminGrowthDelta(value: number) {
  if (value > 0) return `较上周同期 +${value.toLocaleString()}`;
  if (value < 0) return `较上周同期 ${value.toLocaleString()}`;
  return "与上周同期持平";
}

function videoStatusLabel(status: string) {
  return ({ APPROVED: "已到账", REJECTED: "已驳回", REVOKED: "已撤销", FAILED: "抓取失败", PROCESSING: "处理中", PENDING_REVIEW: "待审核" } as Record<string, string>)[status] ?? status;
}

function orderStatusLabel(status: string, kind: GiftKindValue) {
  return ({
    PENDING: kind === "PHYSICAL" ? "待采购" : kind === "MEMBERSHIP" ? "待开通" : "待发放",
    APPROVED: kind === "PHYSICAL" ? "已下单，待采购" : kind === "MEMBERSHIP" ? "待开通" : "待发放",
    FULFILLED: kind === "PHYSICAL" ? "已发货" : kind === "MEMBERSHIP" ? "已开通" : "已发放",
    REJECTED: "已驳回",
    REFUNDED: "已退款",
  } as Record<string, string>)[status] ?? status;
}

const gifts = [
  {
    name: "剪辑团定制保温杯",
    points: 680,
    stock: 38,
    image: "https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=500&q=82",
  },
  {
    name: "创作者桌面收纳套装",
    points: 420,
    stock: 12,
    image: "https://images.unsplash.com/photo-1586953208448-b95a79798f07?auto=format&fit=crop&w=500&q=82",
  },
  {
    name: "视频剪辑会员月卡",
    points: 260,
    stock: 86,
    image: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=500&q=82",
  },
];

function AdminBrand() {
  return (
    <Link href="/" className="admin-brand">
      <span className="brand-mark">妙</span>
      <span><strong>妙妙剪辑团</strong><small>积分中心 · 管理后台</small></span>
    </Link>
  );
}

function AdminSidebar({
  active,
  pendingVideos,
  pendingOrders,
  onChange,
  onLogout,
}: {
  active: AdminSection;
  pendingVideos: number;
  pendingOrders: number;
  onChange: (section: AdminSection) => void;
  onLogout: () => void;
}) {
  const groups = [
    {
      label: "工作台",
      items: [
        { id: "workbench" as const, label: "运营工作台", icon: LayoutDashboard },
        { id: "videos" as const, label: "视频与申诉", icon: ClipboardCheck, badge: pendingVideos ? pendingVideos.toString() : undefined },
      ],
    },
    {
      label: "业务管理",
      items: [
        { id: "users" as const, label: "用户与公会", icon: Users },
        { id: "points" as const, label: "积分管理", icon: CircleDollarSign },
        { id: "gifts" as const, label: "礼品管理", icon: Gift },
        { id: "orders" as const, label: "兑换订单", icon: PackageCheck, badge: pendingOrders ? pendingOrders.toString() : undefined },
        { id: "rankings" as const, label: "榜单结算", icon: Trophy },
        { id: "challenges" as const, label: "AI 周挑战", icon: Sparkles },
        { id: "announcements" as const, label: "公告通知", icon: Megaphone },
      ],
    },
    {
      label: "系统",
      items: [
        { id: "logs" as const, label: "审计日志", icon: FileText },
      ],
    },
  ];
  return (
    <aside className="admin-sidebar">
      <AdminBrand />
      <div className="admin-workspace">
        <span className="workspace-avatar">管</span>
        <div><strong>妙妙剪辑团</strong><span>管理员工作区</span></div>
        <ChevronDown size={15} />
      </div>
      <nav className="admin-nav">
        {groups.map((group) => (
          <div className="admin-nav-group" key={group.label}>
            <span className="admin-nav-label">{group.label}</span>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => onChange(item.id)}>
                  <Icon size={18} />
                  <span>{item.label}</span>
                  {"badge" in item && item.badge && <b>{item.badge}</b>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="admin-sidebar-footer">
        <button onClick={() => window.location.assign("/password-support")}><ShieldCheck size={17} />密码协助中心</button>
        <button className={active === "settings" ? "active" : ""} onClick={() => onChange("settings")}><Settings2 size={17} />系统设置</button>
        <button onClick={onLogout}><LogOut size={17} />退出后台</button>
      </div>
    </aside>
  );
}

function StatCard({
  label,
  value,
  trend,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  trend: string;
  icon: typeof Users;
  tone: "coral" | "teal" | "yellow" | "purple";
}) {
  return (
    <div className="admin-stat-card">
      <div className={`admin-stat-icon ${tone}`}><Icon size={19} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small className={trend.startsWith("+") ? "trend-up" : "trend-down"}>
        {trend.startsWith("+") ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} {trend}
      </small>
    </div>
  );
}

function Overview({ data }: { data: AdminData }) {
  const trendMax = Math.max(1, ...data.pointsTrend.flatMap((item) => [item.videoReward, item.adminAdjustment]));
  return (
    <>
      <div className="admin-page-title">
        <div><span className="eyebrow">{formatAdminToday()}</span><h1>数据概览</h1><p>欢迎回来，今天也一起看好每一份创作贡献。</p></div>
        <button className="secondary-button"><FileText size={16} />导出报表</button>
      </div>
      <div className="admin-stat-grid">
        <StatCard label="成员总数" value={data.metrics.users.toLocaleString()} trend="+ 实时" icon={Users} tone="coral" />
        <StatCard label="账户积分总量" value={data.metrics.totalBalance.toLocaleString()} trend="+ 实时" icon={CircleDollarSign} tone="teal" />
        <StatCard label="视频待办" value={data.metrics.pendingVideos.toLocaleString()} trend="+ 待办" icon={ClipboardCheck} tone="yellow" />
        <StatCard label="待处理订单" value={data.metrics.pendingOrders.toLocaleString()} trend="+ 待办" icon={PackageCheck} tone="purple" />
      </div>
      <div className="admin-dashboard-grid">
        <section className="admin-panel chart-panel">
          <div className="admin-panel-head"><div><h2>积分发放趋势</h2><p>过去 7 天的每日积分发放情况</p></div><button className="panel-menu"><MoreHorizontal size={18} /></button></div>
          <div className="chart-legend"><span><i className="legend-dot coral-dot" />视频奖励</span><span><i className="legend-dot teal-dot" />管理员调整</span><button>近 7 天 <ChevronDown size={14} /></button></div>
          <div className="bar-chart">
            {data.pointsTrend.map((item) => (
              <div className="bar-column" key={item.label}><div className="bar-stack"><i style={{ height: `${Math.max(3, (item.videoReward / trendMax) * 140)}px` }} /><b style={{ height: `${Math.max(3, (item.adminAdjustment / trendMax) * 140)}px` }} /></div><span>{item.label}</span></div>
            ))}
          </div>
          <div className="chart-total"><span>当前账户积分</span><strong>{data.metrics.totalBalance.toLocaleString()} <small>积分</small></strong><span className="trend-up"><ArrowUpRight size={13} /> 实时</span></div>
        </section>
        <section className="admin-panel exception-panel">
          <div className="admin-panel-head"><div><h2>需要关注</h2><p>异常视频与待处理订单</p></div><AlertTriangle size={19} color="#b8750a" /></div>
          <div className="exception-list">
            <div><span className="exception-icon danger"><AlertTriangle size={16} /></span><div><strong>视频审核待办</strong><small>{data.metrics.pendingSecondaryReviews ?? 0} 条二审 · {data.metrics.pendingAppeals ?? 0} 条申诉</small></div><b>{data.metrics.pendingVideos}</b></div>
            <div><span className="exception-icon warning"><Activity size={16} /></span><div><strong>在架礼品</strong><small>库存与状态实时同步</small></div><b>{data.metrics.activeGifts}</b></div>
            <div><span className="exception-icon teal"><PackageCheck size={16} /></span><div><strong>待处理订单</strong><small>兑换积分已锁定</small></div><b>{data.metrics.pendingOrders}</b></div>
          </div>
          <button className="secondary-button full-button">查看全部待处理 <ChevronRight size={16} /></button>
        </section>
      </div>
      {data.memberGrowth && (
        <section className="admin-panel member-growth-panel">
          <div className="admin-panel-head">
            <div><h2>本周成员参与</h2><p>按上海时间与上周同期比较，只读展示，不触发积分操作</p></div>
            <BarChart3 size={19} color="#6850ab" />
          </div>
          <div className="member-growth-admin-grid">
            <div><span>有效成员</span><strong>{data.memberGrowth.activeMembers.toLocaleString()}</strong><small>当前有效普通成员</small></div>
            <div><span>提交人数</span><strong>{data.memberGrowth.currentWeek.submitters.toLocaleString()}</strong><small className={data.memberGrowth.delta.submitters < 0 ? "trend-down" : "trend-up"}>{adminGrowthDelta(data.memberGrowth.delta.submitters)}</small></div>
            <div><span>通过人数</span><strong>{data.memberGrowth.currentWeek.approvedSubmitters.toLocaleString()}</strong><small className={data.memberGrowth.delta.approvedSubmitters < 0 ? "trend-down" : "trend-up"}>{adminGrowthDelta(data.memberGrowth.delta.approvedSubmitters)}</small></div>
            <div><span>通过切片</span><strong>{data.memberGrowth.currentWeek.approvedVideos.toLocaleString()}</strong><small className={data.memberGrowth.delta.approvedVideos < 0 ? "trend-down" : "trend-up"}>{adminGrowthDelta(data.memberGrowth.delta.approvedVideos)}</small></div>
            <div><span>点赞量</span><strong>{data.memberGrowth.currentWeek.likes.toLocaleString()}</strong><small className={data.memberGrowth.delta.likes < 0 ? "trend-down" : "trend-up"}>{adminGrowthDelta(data.memberGrowth.delta.likes)}</small></div>
            <div><span>视频积分</span><strong>{data.memberGrowth.currentWeek.videoPoints.toLocaleString()}</strong><small className={data.memberGrowth.delta.videoPoints < 0 ? "trend-down" : "trend-up"}>{adminGrowthDelta(data.memberGrowth.delta.videoPoints)}</small></div>
          </div>
          <div className="member-growth-challenge">
            <span>本周挑战</span>
            <strong>{data.memberGrowth.challenge.covered.toLocaleString()} 人覆盖</strong>
            <span>{data.memberGrowth.challenge.completed.toLocaleString()} 人达标</span>
            <span>{data.memberGrowth.challenge.claimed.toLocaleString()} 人已领取</span>
          </div>
        </section>
      )}
      <section className="admin-panel audit-panel">
        <div className="admin-panel-head"><div><h2>最近视频记录</h2><p>实时查看自动入账和异常状态</p></div><button className="text-button">查看全部 <ChevronRight size={15} /></button></div>
        <AuditTable rows={data.recentVideos} compact />
      </section>
    </>
  );
}

function AuditTable({ rows, compact = false, onAction, onActivity }: { rows: AdminVideo[]; compact?: boolean; onAction?: (video: AdminVideo, action: "revoke" | "reprocess") => void; onActivity?: (video: AdminVideo) => void }) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead><tr><th>视频与成员</th><th>点赞</th><th>奖励积分</th><th>状态</th>{!compact && <th>结果说明</th>}<th>提交时间</th><th /></tr></thead>
        <tbody>
          {(compact ? rows.slice(0, 4) : rows).map((row) => {
            const href = canonicalKuaishouVideoUrl(row.photoId);
            const reason = row.reviewReason?.trim() || (row.status === "APPROVED" ? "自动审核通过" : "历史记录未保存具体原因");
            return (
              <tr key={row.id}>
                <td><div className="table-main"><span className="table-thumb">▶</span><div>{href
                  ? <a className="video-source-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={`打开${row.user.nickname}已核验的快手视频`} title="在新标签页打开已核验的快手视频"><strong>{row.sourceUrl}</strong><ExternalLink size={13} /></a>
                  : <strong className="video-source-invalid" title="该历史记录没有可核验的视频 ID，无法提供跳转">{row.sourceUrl}</strong>}<small>{row.user.nickname} · {row.user.kuaishouId}</small></div></div></td>
                <td>{row.likes?.toLocaleString() ?? "未获取"}</td><td className={row.status === "APPROVED" && row.points > 0 ? "positive-text" : ""}>{row.status === "APPROVED" && row.points > 0 ? `+${row.points.toLocaleString()}` : "未入账"}</td>
                <td><span className={`status-chip ${row.status === "APPROVED" ? "success" : row.status === "FAILED" ? "warning" : "danger"}`}>{videoStatusLabel(row.status)}</span></td>
                {!compact && <td><details className="video-result-detail"><summary title={reason}>{reason}</summary><div><span>抓取作者：{row.fetchedOwner ?? "未获取"}</span><span>提交昵称：{row.submittedNickname || "未记录"}</span><span>photoId：{row.photoId ?? "未获取"}</span></div></details></td>}
                <td>{formatAdminDate(row.submittedAt)}</td>
                <td>{onAction ? <div className="table-actions-inline">
                  {onActivity && <button className="table-more" title="查看操作动态" aria-label="查看视频操作动态" onClick={() => onActivity(row)}><FileText size={16} /></button>}
                  {row.status === "APPROVED" && <button className="table-more" title="撤销并扣回积分" aria-label="撤销视频积分" onClick={() => onAction(row, "revoke")}><X size={16} /></button>}
                  {["REJECTED", "FAILED"].includes(row.status) && <button className="table-more" title="重新抓取并自动审核" aria-label="重新抓取" onClick={() => onAction(row, "reprocess")}><Activity size={16} /></button>}
                </div> : <button className="table-more" aria-label="更多操作"><MoreHorizontal size={17} /></button>}</td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={compact ? 6 : 7}>暂无视频记录</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function VideosAdmin({
  rows,
  pagination,
  onAction,
  onLoadMore,
  onSearch,
  onFilter,
  onActivity,
}: {
  rows: AdminVideo[];
  pagination: AdminPagination;
  onAction: (video: AdminVideo, action: "revoke" | "reprocess") => void;
  onLoadMore: () => Promise<void>;
  onSearch: (query: string) => Promise<void>;
  onFilter: (status: string) => Promise<void>;
  onActivity: (video: AdminVideo) => void;
}) {
  const [filter, setFilter] = useState("全部");
  const [query, setQuery] = useState("");
  const statusForFilter: Record<string, string> = { 全部: "", 抓取失败: "FAILED", 已到账: "APPROVED", 已驳回: "REJECTED", 已撤销: "REVOKED" };
  async function submitSearch() {
    await onSearch(query.trim());
  }
  return (
    <>
      <div className="admin-tabs">
        {Object.keys(statusForFilter).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => { setFilter(item); void onFilter(statusForFilter[item]); }}>{item}{filter === item && <span>{pagination.total}</span>}</button>)}
      </div>
      <section className="admin-panel audit-panel">
        <div className="admin-panel-head"><div><h2>{filter}视频</h2><p>共 {pagination.total} 条记录，当前第 {pagination.page} / {pagination.pages} 页</p></div><div className="table-actions"><div className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitSearch(); }} placeholder="搜索链接、photoId、作者、驳回原因或快手 ID" /></div><button className="icon-button" title="执行搜索" aria-label="执行搜索" onClick={() => void submitSearch()}><Search size={18} /></button></div></div>
        <AuditTable rows={rows} onAction={onAction} onActivity={onActivity} />
        {pagination.page < pagination.pages && <div className="admin-panel-actions"><button className="secondary-button" onClick={() => void onLoadMore()}>加载更多视频 <ChevronDown size={15} /></button></div>}
      </section>
    </>
  );
}

function AppealsAdmin({
  rows,
  pagination,
  onAction,
  onLoadMore,
  onSearch,
}: {
  rows: AdminAppeal[];
  pagination: AdminPagination;
  onAction: (appeal: AdminAppeal, action: "approve" | "reject") => void;
  onLoadMore: () => Promise<void>;
  onSearch: (query: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  async function submitSearch() {
    await onSearch(query.trim());
  }
  return (
    <>
      <section className="admin-panel audit-panel">
        <div className="admin-panel-head"><div><h2>待复查申诉</h2><p>共 {pagination.total} 条，当前第 {pagination.page} / {pagination.pages} 页；普通视频由系统直接通过或驳回</p></div><div className="table-actions"><div className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitSearch(); }} placeholder="搜索成员、视频或申诉原因" /></div><button className="icon-button" title="执行搜索" aria-label="执行搜索" onClick={() => void submitSearch()}><Search size={18} /></button></div></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>成员</th><th>视频</th><th>自动结果</th><th>申诉理由</th><th>提交时间</th><th /></tr></thead><tbody>
          {rows.map((appeal) => <tr key={appeal.id}>
            <td><div className="table-main"><span className="table-avatar">{appeal.user.nickname.slice(0, 1)}</span><div><strong>{appeal.user.nickname}</strong><small>{appeal.user.kuaishouId}</small></div></div></td>
            <td><div className="table-main"><div><strong>{appeal.video.likes?.toLocaleString() ?? "未获取"} 赞</strong><small>{appeal.video.sourceUrl.slice(0, 48)}</small></div></div></td>
            <td><span className="status-chip danger">{appeal.video.reviewReason ?? "自动驳回"}</span><small>抓取作者：{appeal.video.fetchedOwner ?? "未获取"} · 提交昵称：{appeal.video.submittedNickname}</small></td>
            <td>{appeal.reason}</td>
            <td>{formatAdminDate(appeal.createdAt)}</td>
            <td><div className="table-actions-inline">
              <button className="table-more" title="通过申诉并入账" aria-label="通过申诉" onClick={() => onAction(appeal, "approve")}><Check size={16} /></button>
              <button className="table-more" title="驳回申诉" aria-label="驳回申诉" onClick={() => onAction(appeal, "reject")}><X size={16} /></button>
            </div></td>
          </tr>)}
          {rows.length === 0 && <tr><td colSpan={6}>暂无待复查申诉</td></tr>}
        </tbody></table></div>
        {pagination.page < pagination.pages && <div className="admin-panel-actions"><button className="secondary-button" onClick={() => void onLoadMore()}>加载更多申诉 <ChevronDown size={15} /></button></div>}
      </section>
    </>
  );
}

function SecondaryReviewsAdmin({
  rows,
  pagination,
  onAction,
  onLoadMore,
  onFilter,
  onActivity,
}: {
  rows: AdminSecondaryReview[];
  pagination: AdminPagination;
  onAction: (review: AdminSecondaryReview, action: "approve" | "reject") => void;
  onLoadMore: () => Promise<void>;
  onFilter: (status: "PENDING" | "APPROVED" | "REJECTED") => Promise<void>;
  onActivity: (video: AdminVideo) => void;
}) {
  const [filter, setFilter] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const labels: Record<typeof filter, string> = { PENDING: "待二审", APPROVED: "二审通过", REJECTED: "二审驳回" };
  function changeFilter(next: typeof filter) {
    setFilter(next);
    void onFilter(next);
  }
  return (
    <>
      <div className="admin-tabs">
        {(["PENDING", "APPROVED", "REJECTED"] as const).map((status) => (
          <button key={status} className={filter === status ? "active" : ""} onClick={() => changeFilter(status)}>
            {labels[status]}{filter === status && <span>{pagination.total}</span>}
          </button>
        ))}
      </div>
      <section className="admin-panel audit-panel">
        <div className="admin-panel-head"><div><h2>{labels[filter]}</h2><p>共 {pagination.total} 条，当前第 {pagination.page} / {pagination.pages} 页；驳回会自动扣回视频积分</p></div></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>成员与视频</th><th>数据</th><th>审核员</th><th>状态</th><th>时间</th><th /></tr></thead><tbody>
          {rows.map((review) => {
            const href = canonicalKuaishouVideoUrl(review.video.photoId) ?? review.video.sourceUrl;
            return (
              <tr key={review.id}>
                <td><div className="table-main">{review.video.coverUrl ? <span className="table-thumb video-cover-thumb"><img src={review.video.coverUrl} alt="" /></span> : <span className="table-thumb">▶</span>}<div><a className="video-source-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={`打开${review.video.user.nickname}的二审视频`} title="打开快手视频"><strong>{review.video.caption || review.video.sourceUrl}</strong><ExternalLink size={13} /></a><small>{review.video.user.nickname} · {review.video.user.kuaishouId}</small></div></div></td>
                <td><strong>{review.video.likes?.toLocaleString() ?? "未获取"} 赞</strong><small>{review.video.points.toLocaleString()} 积分 · photoId {review.video.photoId ?? "未获取"}</small></td>
                <td>{review.reviewer ? <><span>{review.reviewer.nickname}</span><small>{review.reviewer.kuaishouId}</small></> : <span className="status-chip warning">未分配</span>}</td>
                <td><span className={`status-chip ${review.status === "APPROVED" ? "success" : review.status === "REJECTED" ? "danger" : "warning"}`}>{labels[review.status]}</span>{review.reviewReason && <small>{review.reviewReason}</small>}</td>
                <td>{formatAdminDate(review.reviewedAt ?? review.assignedAt ?? review.createdAt)}</td>
                <td><div className="table-actions-inline">
                  <button className="table-more" title="查看操作动态" aria-label="查看视频操作动态" onClick={() => onActivity(review.video)}><FileText size={16} /></button>
                  {review.status === "PENDING" && <button className="table-more" title="二审通过" aria-label="二审通过" onClick={() => onAction(review, "approve")}><Check size={16} /></button>}
                  {review.status === "PENDING" && <button className="table-more" title="二审驳回并扣回积分" aria-label="二审驳回" onClick={() => onAction(review, "reject")}><X size={16} /></button>}
                </div></td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={6}>暂无二次审核任务</td></tr>}
        </tbody></table></div>
        {pagination.page < pagination.pages && <div className="admin-panel-actions"><button className="secondary-button" onClick={() => void onLoadMore()}>加载更多二审任务 <ChevronDown size={15} /></button></div>}
      </section>
    </>
  );
}

function VideoManagement({
  secondaryReviews,
  videos,
  appeals,
  secondaryReviewsPagination,
  videosPagination,
  appealsPagination,
  onSecondaryReviewAction,
  onVideoAction,
  onAppealAction,
  onLoadMoreSecondaryReviews,
  onLoadMoreVideos,
  onLoadMoreAppeals,
  onFilterSecondaryReviews,
  onSearchVideos,
  onFilterVideos,
  onSearchAppeals,
  onVideoActivity,
}: {
  secondaryReviews: AdminSecondaryReview[];
  videos: AdminVideo[];
  appeals: AdminAppeal[];
  secondaryReviewsPagination: AdminPagination;
  videosPagination: AdminPagination;
  appealsPagination: AdminPagination;
  onSecondaryReviewAction: (review: AdminSecondaryReview, action: "approve" | "reject") => void;
  onVideoAction: (video: AdminVideo, action: "revoke" | "reprocess") => void;
  onAppealAction: (appeal: AdminAppeal, action: "approve" | "reject") => void;
  onLoadMoreSecondaryReviews: () => Promise<void>;
  onLoadMoreVideos: () => Promise<void>;
  onLoadMoreAppeals: () => Promise<void>;
  onFilterSecondaryReviews: (status: "PENDING" | "APPROVED" | "REJECTED") => Promise<void>;
  onSearchVideos: (query: string) => Promise<void>;
  onFilterVideos: (status: string) => Promise<void>;
  onSearchAppeals: (query: string) => Promise<void>;
  onVideoActivity: (video: AdminVideo) => void;
}) {
  const [view, setView] = useState<"secondary" | "appeals" | "history">("secondary");
  return (
    <>
      <div className="admin-page-title">
        <div><span className="eyebrow">CONTENT OPERATIONS</span><h1>视频与审核</h1><p>机审通过后进入二次审核池；二审驳回会自动扣回已到账积分。</p></div>
        <span className={`status-chip ${secondaryReviewsPagination.total + appealsPagination.total ? "warning" : "success"}`}>{secondaryReviewsPagination.total + appealsPagination.total} 条待处理</span>
      </div>
      <div className="admin-tabs">
        <button className={view === "secondary" ? "active" : ""} onClick={() => setView("secondary")}>二审池<span>{secondaryReviewsPagination.total}</span></button>
        <button className={view === "appeals" ? "active" : ""} onClick={() => setView("appeals")}>待处理申诉<span>{appealsPagination.total}</span></button>
        <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>视频历史<span>{videosPagination.total}</span></button>
      </div>
      {view === "secondary"
        ? <SecondaryReviewsAdmin rows={secondaryReviews} pagination={secondaryReviewsPagination} onAction={onSecondaryReviewAction} onLoadMore={onLoadMoreSecondaryReviews} onFilter={onFilterSecondaryReviews} onActivity={onVideoActivity} />
        : view === "appeals"
        ? <AppealsAdmin rows={appeals} pagination={appealsPagination} onAction={onAppealAction} onLoadMore={onLoadMoreAppeals} onSearch={onSearchAppeals} />
        : <VideosAdmin rows={videos} pagination={videosPagination} onAction={onVideoAction} onLoadMore={onLoadMoreVideos} onSearch={onSearchVideos} onFilter={onFilterVideos} onActivity={onVideoActivity} />}
    </>
  );
}

function UsersAdmin({ rows, pagination, onToggle, onUpdate, onResetPassword, onLoadMore, onSearch, onFilter }: { rows: AdminUserRow[]; pagination: AdminPagination; onToggle: (user: AdminUserRow) => void; onUpdate: (user: AdminUserRow, input: { role?: "MEMBER" | "REVIEWER" | "ADMIN"; guildStatus?: string }) => void; onResetPassword: (user: AdminUserRow) => void; onLoadMore: () => Promise<void>; onSearch: (query: string) => Promise<void>; onFilter: (filter: "all" | "joined" | "pending") => Promise<void> }) {
  const [filter, setFilter] = useState<"all" | "joined" | "pending">("all");
  const [query, setQuery] = useState("");
  async function submitSearch() {
    await onSearch(query.trim());
  }
  function changeFilter(next: "all" | "joined" | "pending") {
    setFilter(next);
    void onFilter(next);
  }
  return (
    <>
      <div className="admin-page-title">
        <div><span className="eyebrow">MEMBER DIRECTORY</span><h1>用户与公会</h1><p>管理成员身份、邀请状态和积分档案。</p></div>
        <button className="primary-button"><Users size={16} />邀请成员</button>
      </div>
      <div className="admin-tabs"><button className={filter === "all" ? "active" : ""} onClick={() => changeFilter("all")}>全部成员{filter === "all" && <span>{pagination.total}</span>}</button><button className={filter === "joined" ? "active" : ""} onClick={() => changeFilter("joined")}>已入会{filter === "joined" && <span>{pagination.total}</span>}</button><button className={filter === "pending" ? "active" : ""} onClick={() => changeFilter("pending")}>待处理{filter === "pending" && <span>{pagination.total}</span>}</button></div>
      <section className="admin-panel audit-panel">
        <div className="admin-panel-head"><div><h2>成员列表</h2><p>显示 {rows.length} 名已加载成员，共 {pagination.total} 名，快手 ID 是唯一身份标识</p></div><div className="table-actions"><div className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitSearch(); }} placeholder="搜索快手 ID 或昵称" /></div><button className="icon-button" title="执行搜索" aria-label="执行搜索" onClick={() => void submitSearch()}><Search size={18} /></button></div></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>成员</th><th>角色</th><th>公会状态</th><th>当前积分</th><th>有效视频</th><th>注册时间</th><th /></tr></thead><tbody>{rows.map((user) => <tr key={user.id}><td><div className="table-main"><span className="table-avatar"><img src={user.avatarUrl || "/avatars/default.webp"} alt="" /></span><div><strong>{user.nickname}</strong><small>{user.kuaishouId}</small></div></div></td><td><select value={user.role} onChange={(event) => onUpdate(user, { role: event.target.value as "MEMBER" | "REVIEWER" | "ADMIN" })} aria-label={`${user.nickname}角色`}><option value="MEMBER">普通成员</option><option value="REVIEWER">审核员</option><option value="ADMIN">管理员</option></select></td><td><select value={user.guildStatus ?? "未设置"} onChange={(event) => onUpdate(user, { guildStatus: event.target.value })} aria-label={`${user.nickname}公会状态`}><option>未设置</option><option>已邀请</option><option>已入会</option><option>已绑定</option><option>未绑定</option></select></td><td>{(user.account?.balance ?? 0).toLocaleString()}</td><td>{user._count.videos}</td><td>{formatAdminDate(user.createdAt)}</td><td><div className="table-actions-inline"><button className="table-more" title="重置密码" aria-label={`重置${user.nickname}密码`} onClick={() => onResetPassword(user)}><KeyRound size={15} /></button><button className="table-more" title={user.active ? "停用账号" : "启用账号"} aria-label={user.active ? "停用账号" : "启用账号"} onClick={() => onToggle(user)}>{user.active ? <X size={16} /> : <Check size={16} />}</button></div></td></tr>)}{rows.length === 0 && <tr><td colSpan={7}>没有匹配的成员</td></tr>}</tbody></table></div>
        {pagination.page < pagination.pages && <div className="admin-panel-actions"><button className="secondary-button" onClick={() => void onLoadMore()}>加载更多成员 <ChevronDown size={15} /></button></div>}
      </section>
    </>
  );
}

function GiftEditorDialog({ gift, onClose, onSave }: { gift: AdminGiftRow | null; onClose: () => void; onSave: (input: GiftEditorInput) => Promise<void> }) {
  const [name, setName] = useState(gift?.name ?? "");
  const [kind, setKind] = useState<GiftKindValue>(gift?.kind ?? "PHYSICAL");
  const [category, setCategory] = useState(gift?.category ?? "实用好物");
  const [tagsText, setTagsText] = useState((gift?.tags ?? []).join("、"));
  const [fulfillmentFields, setFulfillmentFields] = useState<MembershipFieldDefinition[]>(gift?.fulfillmentFields ?? []);
  const [pointsCost, setPointsCost] = useState(String(gift?.pointsCost ?? ""));
  const [stock, setStock] = useState(String(gift?.stock ?? ""));
  const [imageUrl, setImageUrl] = useState(gift?.imageUrl ?? "");
  const [description, setDescription] = useState(gift?.description ?? "");
  const [active, setActive] = useState(gift?.active ?? true);
  const [pinned, setPinned] = useState(gift?.pinned ?? false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  function applyAutomaticClassification(nextKind = kind) {
    const inferred = inferGiftCategory(name, nextKind);
    setCategory(inferred);
    setTagsText(inferGiftTags(name, nextKind, inferred).join("、"));
  }
  function changeKind(nextKind: GiftKindValue) {
    setKind(nextKind);
    const inferred = inferGiftCategory(name, nextKind);
    setCategory(inferred);
    setTagsText(inferGiftTags(name, nextKind, inferred).join("、"));
    if (nextKind === "MEMBERSHIP" && fulfillmentFields.length === 0) {
      setFulfillmentFields([{
        key: "membership_account",
        label: "会员账号",
        type: "TEXT",
        required: true,
        placeholder: "请输入需要开通会员的平台账号",
      }]);
    }
  }
  function addFulfillmentField() {
    if (fulfillmentFields.length >= 8) return;
    let index = fulfillmentFields.length + 1;
    while (fulfillmentFields.some((field) => field.key === `field_${index}`)) index += 1;
    setFulfillmentFields((current) => [...current, { key: `field_${index}`, label: `开通资料 ${index}`, type: "TEXT", required: true }]);
  }
  function updateFulfillmentField(index: number, patch: Partial<MembershipFieldDefinition>) {
    setFulfillmentFields((current) => current.map((field, currentIndex) => currentIndex === index ? { ...field, ...patch } : field));
  }
  async function uploadImage(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("image", file);
      const response = await fetch("/api/admin/gifts/image", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "礼品图片上传失败");
      setImageUrl(result.imageUrl);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "礼品图片上传失败");
    } finally {
      setUploading(false);
    }
  }
  async function save() {
    setSaving(true);
    setError("");
    try {
      const tags = tagsText.split(/[，,、]/u).map((tag) => tag.trim()).filter(Boolean);
      await onSave({
        name,
        kind,
        category,
        tags,
        fulfillmentFields: kind === "MEMBERSHIP" ? fulfillmentFields : [],
        pointsCost: Number(pointsCost),
        stock: Number(stock),
        imageUrl: imageUrl || null,
        description: description || null,
        active,
        pinned,
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-sheet admin-gift-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><span className="eyebrow">REWARD CATALOG</span><h2>{gift ? "编辑礼品" : "新增礼品"}</h2></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={20} /></button></div>
        <div className="field"><label htmlFor="gift-name">礼品名称</label><input id="gift-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
        <div className="field"><label htmlFor="gift-kind">兑换类型</label><select id="gift-kind" value={kind} onChange={(event) => changeKind(event.target.value as GiftKindValue)}><option value="PHYSICAL">实物商品</option><option value="CASH">现金兑换</option><option value="MEMBERSHIP">会员权益（视频 / 剪辑软件）</option></select></div>
        <div className="admin-form-grid">
          <div className="field"><label htmlFor="gift-category">商城分类</label><input id="gift-category" list="gift-category-options" value={category} onChange={(event) => setCategory(event.target.value)} maxLength={20} /><datalist id="gift-category-options">{DEFAULT_GIFT_CATEGORIES.map((value) => <option value={value} key={value} />)}</datalist></div>
          <div className="field"><label htmlFor="gift-tags">商品标签（最多 6 个）</label><input id="gift-tags" value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="用逗号或顿号分隔" /></div>
        </div>
        <button className="secondary-button gift-auto-classify" type="button" onClick={() => applyAutomaticClassification()}><Sparkles size={15} />按商品名自动分类并打标签</button>
        <div className="admin-form-grid"><div className="field"><label htmlFor="gift-points">积分价格</label><input id="gift-points" type="number" min="1" value={pointsCost} onChange={(event) => setPointsCost(event.target.value)} /></div><div className="field"><label htmlFor="gift-stock">库存</label><input id="gift-stock" type="number" min="0" value={stock} onChange={(event) => setStock(event.target.value)} /></div></div>
        {kind === "MEMBERSHIP" && (
          <section className="membership-field-editor">
            <div className="membership-field-editor-head"><div><strong>成员兑换时需要填写的资料</strong><span>最多 8 项，提交后会加密保存</span></div><button className="secondary-button mini-button" type="button" disabled={fulfillmentFields.length >= 8} onClick={addFulfillmentField}><Plus size={15} />添加字段</button></div>
            {fulfillmentFields.map((field, index) => (
              <div className="membership-field-row" key={`${field.key}-${index}`}>
                <div className="admin-form-grid">
                  <div className="field"><label>字段名称</label><input value={field.label} maxLength={30} onChange={(event) => updateFulfillmentField(index, { label: event.target.value })} placeholder="例如：爱奇艺账号" /></div>
                  <div className="field"><label>字段标识</label><input value={field.key} maxLength={40} onChange={(event) => updateFulfillmentField(index, { key: event.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} placeholder="例如：iqiyi_account" /></div>
                  <div className="field"><label>填写类型</label><select value={field.type} onChange={(event) => updateFulfillmentField(index, { type: event.target.value as MembershipFieldType, options: event.target.value === "SELECT" ? (field.options?.length ? field.options : ["选项一", "选项二"]) : undefined })}><option value="TEXT">单行文本</option><option value="PHONE">手机号</option><option value="EMAIL">邮箱</option><option value="NUMBER">数字</option><option value="TEXTAREA">多行备注</option><option value="SELECT">下拉选择</option></select></div>
                  <div className="field"><label>填写提示</label><input value={field.placeholder ?? ""} maxLength={80} onChange={(event) => updateFulfillmentField(index, { placeholder: event.target.value || undefined })} placeholder="显示给成员的提示" /></div>
                </div>
                {field.type === "SELECT" && <div className="field"><label>下拉选项</label><input value={(field.options ?? []).join("、")} onChange={(event) => updateFulfillmentField(index, { options: event.target.value.split(/[，,、]/u).map((value) => value.trim()).filter(Boolean) })} placeholder="用逗号或顿号分隔，至少两个" /></div>}
                <div className="membership-field-row-actions"><label className="checkbox-field"><input type="checkbox" checked={field.required} onChange={(event) => updateFulfillmentField(index, { required: event.target.checked })} /> 必填</label><button className="text-button danger-action" type="button" onClick={() => setFulfillmentFields((current) => current.filter((_, currentIndex) => currentIndex !== index))}>删除字段</button></div>
              </div>
            ))}
            {fulfillmentFields.length === 0 && <p className="empty-copy">未配置字段时，成员兑换后直接进入“待开通”。</p>}
          </section>
        )}
        <div className="field"><label>礼品图片</label><div className="gift-image-upload"><img src={imageUrl || gifts[0].image} alt="礼品图片预览" /><div><label className="secondary-button gift-image-upload-button"><ImagePlus size={16} />{uploading ? "处理中..." : imageUrl ? "更换图片" : "选择图片"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={saving || uploading} onChange={(event) => { void uploadImage(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>{imageUrl && <button className="text-button" type="button" disabled={saving || uploading} onClick={() => setImageUrl("")}>移除图片</button>}</div></div></div>
        <div className="field"><label htmlFor="gift-description">说明</label><textarea id="gift-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></div>
        <label className="checkbox-field"><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} /> 置顶商品</label>
        <label className="checkbox-field"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> 上架到成员商城</label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-button" disabled={saving || uploading || !name || !category || !pointsCost} onClick={save}>{saving ? "保存中..." : uploading ? "图片处理中..." : "保存礼品"}</button>
      </section>
    </div>
  );
}

function GiftsAdmin({ rows, orders, busyGiftId, onCreate, onEdit, onMove, onTogglePin, onDelete }: { rows: AdminGiftRow[]; orders: AdminOrderRow[]; busyGiftId: string | null; onCreate: () => void; onEdit: (gift: AdminGiftRow) => void; onMove: (gift: AdminGiftRow, direction: -1 | 1) => void; onTogglePin: (gift: AdminGiftRow) => void; onDelete: (gift: AdminGiftRow) => void }) {
  const stock = rows.reduce((total, gift) => total + gift.stock, 0);
  return (
    <>
      <div className="admin-page-title"><div><span className="eyebrow">REWARD CATALOG</span><h1>积分与礼品</h1><p>维护兑换规则、礼品库存和积分流水。</p></div><button className="primary-button" onClick={onCreate}><Gift size={16} />新增礼品</button></div>
      <div className="admin-stat-grid compact-stats"><StatCard label="上架礼品" value={rows.filter((gift) => gift.active).length.toString()} trend="+ 实时" icon={Gift} tone="coral" /><StatCard label="库存总量" value={stock.toLocaleString()} trend="+ 实时" icon={PackageCheck} tone="teal" /><StatCard label="累计兑换" value={orders.length.toString()} trend="+ 实时" icon={CircleDollarSign} tone="yellow" /></div>
      <section className="admin-panel audit-panel"><div className="admin-panel-head"><div><h2>礼品目录</h2><p>置顶商品优先显示，分类与标签会实时同步到成员商城</p></div></div><div className="gift-admin-grid">{rows.map((gift, i) => { const busy = busyGiftId === gift.id; const canMoveUp = i > 0 && rows[i - 1].pinned === gift.pinned; const canMoveDown = i < rows.length - 1 && rows[i + 1].pinned === gift.pinned; const kindLabel = gift.kind === "CASH" ? "现金兑换" : gift.kind === "MEMBERSHIP" ? "会员权益" : "实物商品"; return <div className="gift-admin-card" key={gift.id}><img src={gift.imageUrl && (/^(?:https?:\/\/|\/|data:image\/webp;base64,)/i.test(gift.imageUrl)) ? gift.imageUrl : gifts[i % gifts.length].image} alt={gift.name} /><div><strong>{gift.name}</strong><span>{kindLabel} · {gift.pointsCost.toLocaleString()} 积分 · 库存 {gift.stock} · 已兑 {gift.salesCount}</span><div className="gift-tag-list admin-gift-tags">{(gift.tags?.length ? gift.tags : [gift.category]).slice(0, 4).map((tag) => <small key={tag}>{tag}</small>)}</div><small className={`gift-catalog-state ${gift.active ? "active" : "inactive"}`}>{gift.pinned ? "已置顶 · " : ""}{gift.active ? "已上架" : "已下架"}</small></div><div className="gift-admin-actions"><button className={`table-more ${gift.pinned ? "is-pinned" : ""}`} disabled={busy} title={gift.pinned ? "取消置顶" : "置顶商品"} aria-label={gift.pinned ? `取消置顶${gift.name}` : `置顶${gift.name}`} onClick={() => onTogglePin(gift)}><Pin size={15} /></button><button className="table-more" disabled={busy || !canMoveUp} title="向前移动" aria-label={`向前移动${gift.name}`} onClick={() => onMove(gift, -1)}><ArrowUp size={15} /></button><button className="table-more" disabled={busy || !canMoveDown} title="向后移动" aria-label={`向后移动${gift.name}`} onClick={() => onMove(gift, 1)}><ArrowDown size={15} /></button><button className="table-more" disabled={busy} title="编辑礼品" aria-label={`编辑${gift.name}`} onClick={() => onEdit(gift)}><Pencil size={15} /></button><button className="table-more danger-action" disabled={busy} title="删除礼品" aria-label={`删除${gift.name}`} onClick={() => onDelete(gift)}><Trash2 size={15} /></button></div></div>; })}{rows.length === 0 && <p className="empty-copy">还没有礼品，点击“新增礼品”创建。</p>}</div></section>
    </>
  );
}

function OrderRecipientDetails({ order, loading, onLoad, onViewQr }: { order: AdminOrderRow; loading: boolean; onLoad: () => void; onViewQr: (url: string) => void }) {
  if (order.gift.kind === "MEMBERSHIP") {
    if (!order.membershipFields) {
      return <span className="order-recipient">开通资料：{order.hasFulfillmentData ? <button className="text-button" disabled={loading} onClick={onLoad}>{loading ? "加载中..." : "查看资料"}</button> : "无需额外资料"}</span>;
    }
    if (order.membershipFields.length === 0) return <span className="order-recipient">开通资料：无需额外资料</span>;
    return (
      <span className="order-recipient membership-order-fields">
        开通资料：{order.membershipFields.map((field) => <span key={field.key}><b>{field.label}</b>：{field.value || "未填写"}</span>)}
      </span>
    );
  }
  if (order.gift.kind === "CASH") {
    const safeQrCodeUrl = order.cashQrCodeUrl && /^(https:\/\/|data:image\/(?:png|jpeg|webp);base64,)/i.test(order.cashQrCodeUrl)
      ? order.cashQrCodeUrl
      : null;
    return (
      <span className="order-recipient">
        收款信息：
        {safeQrCodeUrl
          ? <button className="text-button" onClick={() => onViewQr(safeQrCodeUrl)}>查看收款码</button>
          : order.hasCashQrCode ? <button className="text-button" disabled={loading} onClick={onLoad}>{loading ? "加载中..." : "查看收款码"}</button> : "未填写收款码"}
      </span>
    );
  }

  if (!order.recipientName || !order.recipientPhone || !order.recipientAddress) {
    return <span className="order-recipient">收货信息：{order.hasRecipientPhone || order.hasRecipientAddress ? <button className="text-button" disabled={loading} onClick={onLoad}>{loading ? "加载中..." : "查看详情"}</button> : "尚未填写完整"}</span>;
  }

  return (
    <span className="order-recipient">
      收货信息：{order.recipientName} · {order.recipientPhone} · {order.recipientAddress}
    </span>
  );
}

type AdminPromptOptions = {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  inputType?: "text" | "password" | "number";
  multiline?: boolean;
  required?: boolean;
};

function AdminPromptDialog({
  options,
  onCancel,
  onConfirm,
}: {
  options: AdminPromptOptions;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(options.initialValue ?? "");
  const invalid = options.required !== false && !value.trim();
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="modal-sheet admin-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-prompt-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><span className="eyebrow">CONFIRM ACTION</span><h2 id="admin-prompt-title">{options.title}</h2></div>
          <button className="icon-button" aria-label="取消操作" onClick={onCancel}><X size={20} /></button>
        </div>
        <div className="field">
          <label htmlFor="admin-prompt-value">{options.label}</label>
          {options.multiline
            ? <textarea id="admin-prompt-value" autoFocus rows={4} value={value} placeholder={options.placeholder} onChange={(event) => setValue(event.target.value)} />
            : <input id="admin-prompt-value" autoFocus type={options.inputType ?? "text"} value={value} placeholder={options.placeholder} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !invalid) onConfirm(value); }} />}
        </div>
        <div className="admin-panel-actions">
          <button className="secondary-button" onClick={onCancel}>取消</button>
          <button className="primary-button" disabled={invalid} onClick={() => onConfirm(value)}>{options.confirmLabel ?? "确认"}</button>
        </div>
      </section>
    </div>
  );
}

function useAdminPrompt() {
  const [request, setRequest] = useState<{
    options: AdminPromptOptions;
    resolve: (value: string | null) => void;
  } | null>(null);
  function ask(options: AdminPromptOptions) {
    return new Promise<string | null>((resolve) => setRequest({ options, resolve }));
  }
  function finish(value: string | null) {
    const current = request;
    setRequest(null);
    current?.resolve(value);
  }
  return {
    ask,
    dialog: request
      ? <AdminPromptDialog options={request.options} onCancel={() => finish(null)} onConfirm={(value) => finish(value)} />
      : null,
  };
}

function OrdersAdmin({ rows, pagination, onAction, onLoadMore, onSearch, onFilter, onActivity }: { rows: AdminOrderRow[]; pagination: AdminPagination; onAction: (order: AdminOrderRow, action: "approve" | "fulfill" | "update_tracking" | "reject" | "refund", input?: { trackingNumber?: string | null }) => Promise<boolean>; onLoadMore: () => Promise<void>; onSearch: (query: string) => Promise<void>; onFilter: (status: "ALL" | "PENDING" | "FULFILLED") => Promise<void>; onActivity: (order: AdminOrderRow) => void }) {
  const [status, setStatus] = useState<"ALL" | "PENDING" | "FULFILLED">("ALL");
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState<Record<string, Pick<AdminOrderRow, "recipientName" | "recipientPhone" | "recipientAddress" | "cashQrCodeUrl" | "membershipFields">>>({});
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);
  const [qrPreview, setQrPreview] = useState<{ url: string; giftName: string; memberName: string } | null>(null);
  const [processingOrderId, setProcessingOrderId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const { ask, dialog } = useAdminPrompt();
  const loadDetails = async (order: AdminOrderRow) => {
    setDetailsLoadingId(order.id);
    try {
      const response = await fetch(`/api/admin/orders/${order.id}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "订单资料加载失败");
      setDetails((current) => ({ ...current, [order.id]: result.details }));
      if (order.gift.kind === "CASH") {
        const url = result.details?.cashQrCodeUrl;
        if (!url || !/^(https:\/\/|data:image\/(?:png|jpeg|webp);base64,)/i.test(url)) throw new Error("收款码格式无效，无法预览");
        setQrPreview({ url, giftName: order.gift.name, memberName: order.user.nickname });
      }
    } catch (detailsError) {
      setFeedback({ type: "error", message: detailsError instanceof Error ? detailsError.message : "订单资料加载失败" });
    } finally {
      setDetailsLoadingId(null);
    }
  };
  async function submitSearch() {
    await onSearch(query.trim());
  }
  function changeStatus(next: "ALL" | "PENDING" | "FULFILLED") {
    setStatus(next);
    void onFilter(next);
  }
  async function runAction(order: AdminOrderRow, action: "approve" | "fulfill" | "update_tracking" | "reject" | "refund", canFulfill = true) {
    if (processingOrderId) return;
    if (action === "fulfill" && !canFulfill) {
      setFeedback({ type: "error", message: order.gift.kind === "CASH" ? "该订单尚未填写收款码，无法完成" : order.gift.kind === "MEMBERSHIP" ? "该订单尚未填写完整开通资料，无法开通" : "该订单尚未填写完整收货资料，无法发货" });
      return;
    }
    let input: { trackingNumber?: string | null } | undefined;
    if (action === "fulfill" && order.gift.kind === "PHYSICAL") {
      const trackingNumber = await ask({
        title: "确认发货",
        label: "快递单号（可选）",
        initialValue: order.trackingNumber ?? "",
        required: false,
        confirmLabel: "确认发货",
      });
      if (trackingNumber === null) return;
      input = { trackingNumber: trackingNumber.trim() || null };
    }
    if (action === "update_tracking") {
      const trackingNumber = await ask({
        title: "修改快递单号",
        label: "新的快递单号（留空可清除）",
        initialValue: order.trackingNumber ?? "",
        required: false,
        confirmLabel: "保存",
      });
      if (trackingNumber === null) return;
      input = { trackingNumber: trackingNumber.trim() || null };
    }
    setProcessingOrderId(order.id);
    setFeedback(null);
    try {
      const changed = await onAction(order, action, input);
      if (changed) {
        const message = action === "fulfill"
          ? (order.gift.kind === "CASH" ? "订单已发放" : order.gift.kind === "MEMBERSHIP" ? "会员权益已开通" : "订单已发货")
          : action === "update_tracking" ? "快递单号已更新"
          : action === "reject" ? "订单已驳回并退回积分" : action === "refund" ? "订单已退款" : "订单已确认";
        setFeedback({ type: "success", message });
      }
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "订单操作失败，请稍后重试" });
    } finally {
      setProcessingOrderId(null);
    }
  }
  const filtered = rows;
  return (
    <>
      <div className="admin-page-title"><div><span className="eyebrow">FULFILLMENT CENTER</span><h1>兑换订单</h1><p>实物、现金与会员权益分别按发货、发放和开通处理；驳回会退回积分与库存。</p></div><button className="secondary-button"><FileText size={16} />导出订单</button></div>
      <div className="order-status-row"><button className={status === "ALL" ? "active" : ""} onClick={() => changeStatus("ALL")}>全部订单 <b>{status === "ALL" ? pagination.total : rows.length}</b></button><button className={status === "PENDING" ? "active" : ""} onClick={() => changeStatus("PENDING")}>待采购 / 待发放 / 待开通 <b>{status === "PENDING" ? pagination.total : "—"}</b></button><button className={status === "FULFILLED" ? "active" : ""} onClick={() => changeStatus("FULFILLED")}>已发货 / 已发放 / 已开通 <b>{status === "FULFILLED" ? pagination.total : "—"}</b></button></div>
      <section className="admin-panel audit-panel"><div className="admin-panel-head"><div><h2>订单列表</h2><p>显示 {filtered.length} 条已加载订单，共 {pagination.total} 条；驳回订单会自动退回积分和库存</p></div><div className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitSearch(); }} placeholder="搜索订单号或快手 ID" /><button className="icon-button" title="执行搜索" aria-label="执行搜索" onClick={() => void submitSearch()}><Search size={18} /></button></div></div>{feedback && <p className={feedback.type === "success" ? "form-success" : "form-error"} role="alert">{feedback.message}</p>}<div className="order-list">{filtered.map((order, i) => {
        const merged = { ...order, ...details[order.id] };
        const readyToFulfill = order.gift.kind === "CASH"
          ? Boolean(merged.cashQrCodeUrl || merged.hasCashQrCode)
          : order.gift.kind === "MEMBERSHIP"
            ? Boolean(merged.membershipFields || merged.hasFulfillmentData)
            : Boolean(merged.recipientName && (merged.recipientPhone || merged.hasRecipientPhone) && (merged.recipientAddress || merged.hasRecipientAddress));
        const pendingShipment = ["PENDING", "APPROVED"].includes(order.status);
        const processing = processingOrderId === order.id;
        return <div className="order-row" key={order.id}><span className="order-thumb"><img src={order.gift.imageUrl && /^(?:https?:\/\/|\/|data:image\/webp;base64,)/i.test(order.gift.imageUrl) ? order.gift.imageUrl : gifts[i % gifts.length].image} alt="" /></span><div><strong>{order.gift.name}</strong><span>{order.id} · {order.user.nickname} · {order.user.kuaishouId}</span><OrderRecipientDetails order={merged} loading={detailsLoadingId === order.id} onLoad={() => void loadDetails(order)} onViewQr={(url) => setQrPreview({ url, giftName: order.gift.name, memberName: order.user.nickname })} />{order.gift.kind === "PHYSICAL" && order.status === "FULFILLED" && <span className="tracking-copy">{order.trackingNumber ? `快递单号：${order.trackingNumber}` : "未填写快递单号"}{order.fulfilledAt ? ` · ${formatAdminDate(order.fulfilledAt)}` : ""}</span>}</div><b>{order.totalCost.toLocaleString()} 分</b><span className={`status-chip ${pendingShipment ? "warning" : order.status === "REJECTED" || order.status === "REFUNDED" ? "danger" : "success"}`}>{orderStatusLabel(order.status, order.gift.kind)}</span><div className="table-actions-inline"><button className="table-more" title="查看操作动态" aria-label="查看订单操作动态" onClick={() => onActivity(order)}><FileText size={16} /></button>{pendingShipment && <button className="secondary-button mini-button" disabled={Boolean(processingOrderId)} title={readyToFulfill ? undefined : order.gift.kind === "CASH" ? "需先填写收款码" : order.gift.kind === "MEMBERSHIP" ? "需先填写开通资料" : "需先填写完整收货资料"} onClick={() => void runAction(order, "fulfill", readyToFulfill)}>{processing ? "处理中..." : order.gift.kind === "CASH" ? "发放" : order.gift.kind === "MEMBERSHIP" ? "开通" : "发货"}</button>}{pendingShipment && <button className="table-more" disabled={Boolean(processingOrderId)} title="驳回并退回积分" aria-label="驳回订单" onClick={() => void runAction(order, "reject")}><X size={16} /></button>}{order.status === "FULFILLED" && order.gift.kind === "PHYSICAL" && <button className="table-more" disabled={Boolean(processingOrderId)} title="修改快递单号" aria-label="修改快递单号" onClick={() => void runAction(order, "update_tracking")}><PackageCheck size={16} /></button>}{order.status === "FULFILLED" && <button className="table-more" disabled={Boolean(processingOrderId)} title="退款" aria-label="退款" onClick={() => void runAction(order, "refund")}><X size={16} /></button>}</div></div>;
      })}{filtered.length === 0 && <p className="empty-copy">没有匹配的订单</p>}</div>{pagination.page < pagination.pages && <div className="admin-panel-actions"><button className="secondary-button" onClick={() => void onLoadMore()}>加载更多订单 <ChevronDown size={15} /></button></div>}</section>
      {qrPreview && <div className="modal-backdrop" role="presentation" onMouseDown={() => setQrPreview(null)}><section className="modal-sheet qr-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-preview-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">PAYMENT QR CODE</span><h2 id="qr-preview-title">收款码</h2><p>{qrPreview.memberName} · {qrPreview.giftName}</p></div><button className="icon-button" aria-label="关闭收款码预览" onClick={() => setQrPreview(null)}><X size={20} /></button></div><div className="qr-preview-image"><img src={qrPreview.url} alt={`${qrPreview.memberName}的收款码`} /></div></section></div>}
      {dialog}
    </>
  );
}

function RankingsAdmin({
  periods,
  onSettle,
  onAwardUpdate,
}: {
  periods: AdminRankingPeriod[];
  onSettle: (type: "week" | "month", periodStart: string, rewards: Array<{ rank: number; title: string; description?: string }>) => Promise<void>;
  onAwardUpdate: (award: AdminRankingAward, input: { status?: "FULFILLED" }) => void;
}) {
  const [rewards, setRewards] = useState<Record<string, Record<number, { title: string; description: string }>>>({});
  const [settling, setSettling] = useState("");
  const [error, setError] = useState("");
  function updateReward(periodId: string, rank: number, field: "title" | "description", value: string) {
    setRewards((current) => ({ ...current, [periodId]: { ...(current[periodId] ?? {}), [rank]: { ...(current[periodId]?.[rank] ?? { title: "", description: "" }), [field]: value } } }));
  }
  async function settle(period: AdminRankingPeriod) {
    const draft = rewards[period.id] ?? {};
    const preview = period.preview ?? [];
    const missing = preview.find((row) => !draft[row.rank]?.title.trim());
    if (missing) {
      setError(`请填写第 ${missing.rank} 名的奖励名称`);
      return;
    }
    setSettling(period.id);
    setError("");
    try {
      await onSettle(period.type === "WEEK" ? "week" : "month", period.periodStart, preview.map((row) => ({ rank: row.rank, title: draft[row.rank].title.trim(), description: draft[row.rank].description.trim() || undefined })));
    } catch (settleError) {
      setError(settleError instanceof Error ? settleError.message : "榜单结算失败");
    } finally {
      setSettling("");
    }
  }
  return (
    <>
      <div className="admin-page-title">
        <div><span className="eyebrow">RANKING SETTLEMENT</span><h1>榜单结算</h1><p>只结算已结束周期；结算时保存奖励文字快照并向成员发送站内通知。</p></div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {periods.map((period) => (
        <section className="admin-panel audit-panel" key={period.id}>
          <div className="admin-panel-head">
            <div><h2>{period.type === "WEEK" ? "周更新排行榜" : "月点赞量排行榜"}</h2><p>{new Date(period.periodStart).toLocaleDateString("zh-CN")} 至 {new Date(period.periodEnd).toLocaleDateString("zh-CN")} · {period.status === "SETTLED" ? "已结算" : period.settleable ? "待结算" : "进行中"}</p></div>
            <span className={`status-chip ${period.status === "SETTLED" ? "success" : period.settleable ? "warning" : "teal"}`}>{period.status === "SETTLED" ? "已结算" : period.settleable ? "待结算" : "进行中"}</span>
          </div>
          {period.status === "OPEN" && period.settleable && <div className="ranking-settlement-preview"><strong>前五名预览</strong>{(period.preview ?? []).length === 0 ? <span className="field-hint">本期暂无有效成绩，结算后会发送“暂无有效成绩”通知。</span> : <><div className="ranking-preview-list">{period.preview?.map((row) => <div key={row.userId}><span>{row.rank}</span><strong>{row.nickname}</strong><small>{row.kuaishouId}</small><b>{row.value.toLocaleString()} {period.type === "WEEK" ? "个视频" : "赞"}</b></div>)}</div>{period.preview?.map((row) => <div className="ranking-reward-fields" key={`reward-${row.rank}`}><span>第 {row.rank} 名奖励</span><input value={rewards[period.id]?.[row.rank]?.title ?? ""} onChange={(event) => updateReward(period.id, row.rank, "title", event.target.value)} placeholder="奖励名称（必填）" maxLength={120} /><input value={rewards[period.id]?.[row.rank]?.description ?? ""} onChange={(event) => updateReward(period.id, row.rank, "description", event.target.value)} placeholder="奖励说明（可选）" maxLength={500} /></div>)}</>}</div>}
          {period.status === "OPEN" && period.settleable && <div className="admin-panel-actions"><button className="primary-button" disabled={settling === period.id} onClick={() => void settle(period)}><Trophy size={16} />{settling === period.id ? "结算中..." : "确认结算本期榜单"}</button></div>}
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>名次与成员</th><th>成绩</th><th>奖励</th><th>领奖状态</th><th>收货信息</th><th /></tr></thead>
              <tbody>
                {period.awards.map((award) => (
                  <tr key={award.id}>
                    <td><div className="table-main"><span className="table-avatar">{award.rank}</span><div><strong>{award.user.nickname}</strong><small>{award.user.kuaishouId}</small></div></div></td>
                    <td>{award.value.toLocaleString()} {period.type === "WEEK" ? "个视频" : "赞"}</td>
                    <td><strong>{award.rewardTitle ?? "榜单奖励"}</strong>{award.rewardDescription && <small>{award.rewardDescription}</small>}</td>
                    <td><span className={`status-chip ${award.status === "FULFILLED" ? "success" : award.status === "CLAIMED" ? "teal" : "warning"}`}>{award.status === "PENDING" ? "待领奖" : award.status === "CLAIMED" ? "已填写" : award.status === "FULFILLED" ? "已完成" : award.status}</span></td>
                    <td>{award.recipientName ? <><strong>{award.recipientName}</strong><small>{award.recipientPhone}<br />{award.recipientAddress}</small></> : "尚未填写"}</td>
                    <td>{award.status === "CLAIMED" && <button className="secondary-button mini-button" onClick={() => onAwardUpdate(award, { status: "FULFILLED" })}>完成发放</button>}</td>
                  </tr>
                ))}
                {period.awards.length === 0 && <tr><td colSpan={6}>本期暂无获奖成员</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {periods.length === 0 && <section className="admin-panel audit-panel"><p className="empty-copy">尚无已创建的榜单周期</p></section>}
    </>
  );
}

function AnnouncementsAdmin({
  rows,
  users,
  onSave,
  onAction,
}: {
  rows: AdminAnnouncement[];
  users: AdminUserRow[];
  onSave: (input: { id?: string; title: string; content: string; audience: "ALL" | "SELECTED"; recipientIds?: string[] }) => Promise<AdminAnnouncement>;
  onAction: (id: string, action: "publish" | "withdraw") => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | undefined>();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [audience, setAudience] = useState<"ALL" | "SELECTED">("ALL");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const activeMembers = users.filter((user) => user.active && isMemberParticipantRole(user.role));
  const filteredMembers = activeMembers.filter((user) => {
    const query = search.trim().toLowerCase();
    return !query || user.nickname.toLowerCase().includes(query) || user.kuaishouId.toLowerCase().includes(query);
  });

  function resetEditor() {
    setEditingId(undefined);
    setTitle("");
    setContent("");
    setAudience("ALL");
    setSelectedIds([]);
    setFeedback("");
    setError("");
  }

  function edit(row: AdminAnnouncement) {
    setEditingId(row.id);
    setTitle(row.title);
    setContent(row.content);
    setAudience(row.audience);
    setSelectedIds(row.recipients.map((recipient) => recipient.userId));
    setFeedback("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleMember(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function save(publish = false) {
    if (!title.trim() || !content.trim() || (audience === "SELECTED" && selectedIds.length === 0)) {
      setError(audience === "SELECTED" ? "请填写标题、正文并选择至少一名有效成员" : "请填写公告标题和正文");
      return;
    }
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const saved = await onSave({ id: editingId, title: title.trim(), content, audience, recipientIds: audience === "SELECTED" ? selectedIds : [] });
      setEditingId(saved.id);
      if (publish) {
        setActionId(saved.id);
        await onAction(saved.id, "publish");
        setFeedback("公告已发布，通知已在同一事务内发送给目标成员。");
        resetEditor();
      } else {
        setFeedback("草稿已保存。");
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "公告保存失败");
    } finally {
      setSaving(false);
      setActionId("");
    }
  }

  async function action(id: string, next: "publish" | "withdraw") {
    setActionId(id);
    setError("");
    setFeedback("");
    try {
      await onAction(id, next);
      setFeedback(next === "publish" ? "公告已发布。" : "公告已撤回，未读提醒已关闭。");
      if (editingId === id) resetEditor();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "公告操作失败");
    } finally {
      setActionId("");
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div><span className="eyebrow">MESSAGE CENTER</span><h1>公告通知</h1><p>公告发布后不可编辑；撤回会保留审计记录并停止未读弹窗。</p></div>
        <button className="secondary-button" onClick={resetEditor}><Megaphone size={16} />新建公告</button>
      </div>
      {(error || feedback) && <p className={error ? "form-error" : "form-success"} role="status">{error || feedback}</p>}
      <div className="admin-dashboard-grid">
        <section className="admin-panel audit-panel">
          <div className="admin-panel-head"><div><h2>{editingId ? "编辑公告草稿" : "创建公告草稿"}</h2><p>正文按纯文本保存，支持换行，不渲染 HTML。</p></div><Megaphone size={19} color="#ff5a3d" /></div>
          <div className="field admin-panel-form"><label htmlFor="announcement-title">标题</label><input id="announcement-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="例如：本周活动说明" /></div>
          <div className="field admin-panel-form"><label htmlFor="announcement-content">正文</label><textarea id="announcement-content" rows={8} value={content} onChange={(event) => setContent(event.target.value)} maxLength={5000} placeholder="请输入公告内容，换行会原样保留。" /></div>
          <div className="field admin-panel-form"><label htmlFor="announcement-audience">发送范围</label><select id="announcement-audience" value={audience} onChange={(event) => setAudience(event.target.value as "ALL" | "SELECTED")}><option value="ALL">全体有效普通成员</option><option value="SELECTED">定向成员</option></select></div>
          {audience === "SELECTED" && (
            <div className="announcement-recipient-picker">
              <div className="announcement-recipient-head"><strong>选择成员（已选 {selectedIds.length} 人）</strong><div className="admin-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索昵称或快手 ID" /></div></div>
              <div className="announcement-recipient-list">
                {filteredMembers.map((user) => <label className="checkbox-field" key={user.id}><input type="checkbox" checked={selectedIds.includes(user.id)} onChange={() => toggleMember(user.id)} /><span>{user.nickname} · {user.kuaishouId}</span></label>)}
                {filteredMembers.length === 0 && <span className="field-hint">没有匹配的有效普通成员</span>}
              </div>
            </div>
          )}
          <div className="admin-panel-actions"><button className="secondary-button" disabled={saving} onClick={() => void save(false)}>{saving ? "保存中..." : "保存草稿"}</button><button className="primary-button" disabled={saving} onClick={() => void save(true)}><Megaphone size={16} />{saving ? "处理中..." : "保存并立即发布"}</button></div>
        </section>
        <section className="admin-panel audit-panel">
          <div className="admin-panel-head"><div><h2>发布记录</h2><p>全员公告只发送给发布时已存在且有效的普通成员。</p></div></div>
          <div className="announcement-history">
            {rows.map((row) => <article className="announcement-history-row" key={row.id}>
              <div className="announcement-history-main"><div><strong>{row.title}</strong><span>{row.audience === "ALL" ? "全体成员" : `定向 ${row.recipients.length} 人`} · {formatAdminDate(row.createdAt)}</span></div><span className={`status-chip ${row.status === "PUBLISHED" ? "success" : row.status === "WITHDRAWN" ? "danger" : "warning"}`}>{row.status === "PUBLISHED" ? "已发布" : row.status === "WITHDRAWN" ? "已撤回" : "草稿"}</span></div>
              <p>{row.status === "WITHDRAWN" ? "该公告已撤回，成员端正文已隐藏。" : row.content}</p>
              <div className="announcement-history-actions">{row.status === "DRAFT" && <><button className="secondary-button compact-button" onClick={() => edit(row)}>编辑</button><button className="primary-button compact-button" disabled={actionId === row.id} onClick={() => void action(row.id, "publish")}>发布</button></>}{row.status === "PUBLISHED" && <button className="danger-button compact-button" disabled={actionId === row.id} onClick={() => void action(row.id, "withdraw")}>撤回</button>}</div>
            </article>)}
            {rows.length === 0 && <div className="empty-state"><Megaphone size={25} /><strong>还没有公告</strong><span>创建草稿后会显示在这里</span></div>}
          </div>
        </section>
      </div>
    </>
  );
}

function auditJson(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type OperationSwitchRow = {
  key: "VIDEO_SUBMISSIONS" | "POINT_TRANSFERS" | "REDEMPTIONS" | "WEEKLY_CHALLENGES" | "MEMBER_CLEARANCE";
  label: string;
  description: string;
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: { nickname: string; kuaishouId: string } | null;
};

function WeeklyChallengesAdmin({
  periods,
  onRetry,
  onUpgrade,
}: {
  periods: AdminWeeklyChallengePeriod[];
  onRetry: (period: AdminWeeklyChallengePeriod) => Promise<void>;
  onUpgrade: (period: AdminWeeklyChallengePeriod) => Promise<void>;
}) {
  const [detail, setDetail] = useState<AdminWeeklyChallengeDetail | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [upgradingId, setUpgradingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const statusLabel: Record<AdminWeeklyChallengePeriod["status"], string> = {
    GENERATING: "生成中",
    READY: "待生效",
    ACTIVE: "进行中",
    CLOSED: "待领奖",
    FAILED: "生成失败",
    CANCELLED: "已取消",
  };
  const assignmentStatusLabel: Record<string, string> = {
    ACTIVE: "进行中",
    COMPLETED: "已达标",
    CLAIMED: "已领取",
    REVERSED: "已冲正",
    EXPIRED: "已过期",
  };
  const attemptStatusLabel: Record<string, string> = {
    RUNNING: "调用中",
    SUCCEEDED: "已成功",
    FAILED: "失败",
  };
  async function loadDetail(period: AdminWeeklyChallengePeriod) {
    setLoadingId(period.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/weekly-challenges/${period.id}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "周期详情加载失败");
      setDetail(result.period);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "周期详情加载失败");
    } finally {
      setLoadingId(null);
    }
  }
  async function upgradePeriod(period: AdminWeeklyChallengePeriod) {
    setUpgradingId(period.id);
    setError("");
    try {
      await onUpgrade(period);
      await loadDetail(period);
    } catch (upgradeError) {
      setError(upgradeError instanceof Error ? upgradeError.message : "任务重新生成提交失败");
    } finally {
      setUpgradingId(null);
    }
  }
  return (
    <>
      <div className="admin-page-title">
        <div><span className="eyebrow">AI WEEKLY CHALLENGES</span><h1>AI 周挑战</h1><p>查看自动生成覆盖、积分预算、模型批次与成员任务进度。</p></div>
        <span className="status-chip teal">无需逐人审批</span>
      </div>
      {error && <div className="order-feedback error" role="alert"><AlertTriangle size={17} />{error}</div>}
      <section className="admin-panel">
        <div className="admin-panel-head"><div><h2>任务周期</h2><p>仅上周提交过有效视频的成员参与；每个任务同时考核发布量和点赞量，个人最高累计奖励 1,000 分</p></div></div>
        <div className="data-table-wrap">
          <table className="data-table weekly-period-table">
            <thead><tr><th>周期</th><th>状态</th><th>覆盖</th><th>匿名任务分布</th><th>理论奖励</th><th>模型</th><th>竞速冠军</th><th /></tr></thead>
            <tbody>
              {periods.map((period) => {
                const rewardTotal = period.rewardSummary.reduce((sum, row) => sum + (row._sum.rewardPoints ?? 0), 0);
                const distribution = new Map(period.taskDistribution.map((row) => [row.type, row._count.id]));
                return (
                  <tr key={period.id}>
                    <td><strong>{formatAdminDate(period.periodStart)} 起</strong><small>至 {formatAdminDate(period.periodEnd)}</small></td>
                    <td><span className={`status-chip ${period.status === "FAILED" ? "danger" : period.status === "ACTIVE" ? "success" : "warning"}`}>{statusLabel[period.status]}</span>{period.failureReason && <small className="challenge-failure">{period.failureReason}</small>}</td>
                    <td><strong>{period._count.assignments} / {period.audienceCount}</strong><small>{period._count.attempts} 次模型调用</small></td>
                    <td><strong>数量 {distribution.get("VIDEO_COUNT") ?? 0}</strong><small>点赞 {distribution.get("LIKE_SUM") ?? 0} · 组合 {distribution.get("COMBINED") ?? 0}</small></td>
                    <td><strong>{rewardTotal.toLocaleString()} 分</strong><small>上限 {period.personalRewardBudget.toLocaleString()}</small></td>
                    <td><strong>{period.model}</strong><small>{period.promptVersion} · {period.rewardPolicyVersion}</small></td>
                    <td>{period.raceWinner && !period.raceWinner.reversedAt ? <><strong>{period.raceWinner.user.nickname}</strong><small>{period.raceWinner.rewardPoints.toLocaleString()} 分</small></> : <span>尚未产生</span>}</td>
                    <td><div className="table-actions-inline"><button className="secondary-button mini-button" disabled={loadingId === period.id} onClick={() => void loadDetail(period)}>{loadingId === period.id ? "加载中" : "查看"}</button>{period.status === "FAILED" && <button className="secondary-button mini-button" onClick={() => void onRetry(period)}>重试</button>}{period.status === "READY" && period.rewardPolicyVersion !== "tiered-v2-hard-combined" && <button className="secondary-button mini-button" disabled={upgradingId === period.id} onClick={() => void upgradePeriod(period)}>{upgradingId === period.id ? "提交中" : "按两周数据重新生成"}</button>}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {periods.length === 0 && <p className="empty-copy">还没有周挑战周期；功能开关默认关闭。</p>}
      </section>
      {detail && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDetail(null)}>
          <section className="modal-sheet weekly-challenge-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="weekly-detail-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">WEEKLY DETAIL</span><h2 id="weekly-detail-title">周期任务详情</h2></div><button className="icon-button" aria-label="关闭周期详情" onClick={() => setDetail(null)}><X size={20} /></button></div>
            <div className="challenge-detail-metrics">
              <div><span>成员任务</span><strong>{detail.assignments.length}</strong></div>
              <div><span>已达标/领取</span><strong>{detail.assignments.filter((row) => ["COMPLETED", "CLAIMED"].includes(row.status)).length}</strong></div>
              <div><span>模型批次</span><strong>{detail.attempts.length}</strong></div>
              <div><span>模型成本（Token）</span><strong>{detail.attempts.reduce((sum, row) => sum + (row.inputTokens ?? 0) + (row.outputTokens ?? 0), 0).toLocaleString()}</strong></div>
            </div>
            <div className="data-table-wrap challenge-detail-table">
              <table className="data-table weekly-assignment-table">
                <thead><tr><th>成员</th><th>AI 任务</th><th>基线 → 目标</th><th>当前进度</th><th>奖励</th><th>状态</th></tr></thead>
                <tbody>{detail.assignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td><strong>{assignment.user.nickname}</strong><small>{assignment.user.kuaishouId}</small></td>
                    <td><strong>{assignment.title}</strong><small>{assignment.aiReason}</small></td>
                    <td><span>{assignment.baselineVideoCount} → {assignment.targetVideoCount ?? "—"} 条</span><small>{assignment.baselineLikes.toLocaleString()} → {assignment.targetLikes?.toLocaleString() ?? "—"} 赞</small></td>
                    <td><span>{assignment.progress.videoCount} 条</span><small>{assignment.progress.likes.toLocaleString()} 赞</small></td>
                    <td><strong>最高 {assignment.rewardPoints.toLocaleString()}</strong><small>已领 {assignment.claimedRewardPoints.toLocaleString()} · 难度 {assignment.difficultyScore}</small>{assignment.rewardTiers && <small>{assignment.rewardTiers.map((tier) => `${tier.label}：${tier.targetVideoCount ?? "—"}条 + ${tier.targetLikes?.toLocaleString() ?? "—"}赞 / ${tier.rewardPoints}分`).join("；")}</small>}</td>
                    <td><span className={`status-chip ${assignment.status === "CLAIMED" ? "success" : assignment.status === "REVERSED" ? "danger" : "warning"}`}>{assignmentStatusLabel[assignment.status] ?? assignment.status}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="challenge-attempt-list">
              <h3>模型生成记录</h3>
              {detail.attempts.map((attempt) => <div key={attempt.id}><span>批次 {attempt.batchNumber + 1} / 尝试 {attempt.attemptNumber}</span><b>{attemptStatusLabel[attempt.status] ?? attempt.status}</b><span>{attempt.latencyMs ?? "—"} ms</span><span>{(attempt.inputTokens ?? 0) + (attempt.outputTokens ?? 0)} tokens</span>{attempt.error && <small>{attempt.error}</small>}</div>)}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

type ClearanceAdminData = {
  policy: { version: number; inactivityDays: number; warningDays: number[]; cooldownDays: number };
  program: { firstEnabledAt: string | null } | null;
  eligibilities: Array<{ id: string; status: string; cycleStartedAt: string; lastOutputAt: string | null; cooldownEndsAt: string | null; user: { nickname: string; kuaishouId: string; active: boolean }; policyVersion: { version: number } }>;
  requests: Array<{ id: string; requestedAt: string; user: { nickname: string; kuaishouId: string } }>;
  summary: { activeMemberCount: number; clearedHistoryCount: number; currentClearanceCount: number };
  clearedMembers: Array<{ id: string; status: string; clearedAt: string | null; cooldownEndsAt: string | null; rejoinRetryAt: string | null; user: { nickname: string; kuaishouId: string; active: boolean } }>;
};

function clearanceStatusLabel(status: string) {
  if (status === "COOLDOWN") return "冷却中";
  if (status === "REJOIN_PENDING") return "等待恢复审核";
  if (status === "REJOIN_REJECTED") return "恢复申请已驳回";
  if (status === "ACTIVE") return "已恢复资格";
  return status;
}

function MemberClearanceSettings() {
  const [data, setData] = useState<ClearanceAdminData | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ inactivityDays: 30, warning14: 7, warning3: 3, cooldownDays: 15 });
  const load = async () => {
    try {
      const response = await fetch("/api/admin/member-clearance", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "清退数据加载失败");
      setData(result);
      setForm({ inactivityDays: result.policy.inactivityDays, warning14: result.policy.warningDays[0], warning3: result.policy.warningDays[1], cooldownDays: result.policy.cooldownDays });
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "清退数据加载失败"); }
  };
  useEffect(() => { void load(); }, []);
  async function save() {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/admin/member-clearance", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ inactivityDays: form.inactivityDays, warningDays: [form.warning14, form.warning3], cooldownDays: form.cooldownDays }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "规则保存失败");
      await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "规则保存失败"); } finally { setSaving(false); }
  }
  async function review(id: string, action: "APPROVE" | "REJECT") {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/admin/member-clearance/requests/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "申请审核失败");
      await load();
    } catch (reviewError) { setError(reviewError instanceof Error ? reviewError.message : "申请审核失败"); } finally { setSaving(false); }
  }
  return <section className="admin-panel operation-settings-panel">
    <div className="admin-panel-head"><div><h2>成员自动清退</h2><p>规则修改仅应用于新周期；关闭开关不会暂停倒计时，重新开启会立即执行到期清退。</p></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!data ? <p className="empty-copy">正在加载成员资格...</p> : <>
      <div className="member-growth-admin-grid">
        <div><span>当前规则版本</span><strong>v{data.policy.version}</strong><small>{data.program?.firstEnabledAt ? `首次启用：${formatAdminDate(data.program.firstEnabledAt)}` : "尚未启用"}</small></div>
        <div><span>正在预警/计时</span><strong>{data.summary.activeMemberCount}</strong><small>活跃普通成员资格周期</small></div>
        <div><span>待审核恢复</span><strong>{data.requests.length}</strong><small>冷却结束后的申请</small></div>
      </div>
      <div className="admin-form-grid">
        <label>无产出清退天数<input type="number" min={1} value={form.inactivityDays} onChange={(event) => setForm({ ...form, inactivityDays: Number(event.target.value) })} /></label>
        <label>首次预警（剩余天数）<input type="number" min={1} value={form.warning14} onChange={(event) => setForm({ ...form, warning14: Number(event.target.value) })} /></label>
        <label>二次预警（剩余天数）<input type="number" min={1} value={form.warning3} onChange={(event) => setForm({ ...form, warning3: Number(event.target.value) })} /></label>
        <label>冷却天数<input type="number" min={1} value={form.cooldownDays} onChange={(event) => setForm({ ...form, cooldownDays: Number(event.target.value) })} /></label>
      </div>
      <div className="admin-panel-actions"><button className="secondary-button" disabled={saving} onClick={() => void save()}>{saving ? "保存中..." : "创建后续周期规则"}</button></div>
      <h3>重新加入申请</h3>
      {data.requests.length === 0 ? <p className="empty-copy">暂无待审核申请。</p> : <div className="journal-menu">{data.requests.map((row) => <article className="password-support-request" key={row.id}><div><strong>{row.user.nickname}</strong><small>{row.user.kuaishouId} · 申请于 {formatAdminDate(row.requestedAt)}</small></div><div className="table-actions-inline"><button className="secondary-button compact-button" disabled={saving} onClick={() => void review(row.id, "REJECT")}>驳回</button><button className="primary-button compact-button" disabled={saving} onClick={() => void review(row.id, "APPROVE")}>恢复资格</button></div></article>)}</div>}
      <h3>已清退与冷却名单</h3>
      <p className="empty-copy">累计清退 {data.summary.clearedHistoryCount} 人；当前处于冷却或等待恢复状态 {data.summary.currentClearanceCount} 人。展示最近 200 条记录。</p>
      {data.clearedMembers.length === 0 ? <p className="empty-copy">暂无成员被清退。</p> : <div className="journal-menu">{data.clearedMembers.map((row) => <article className="password-support-request" key={row.id}><div><strong>{row.user.nickname}</strong><small>{row.user.kuaishouId} · 清退于 {row.clearedAt ? formatAdminDate(row.clearedAt) : "—"}</small><small>{row.status === "COOLDOWN" && row.cooldownEndsAt ? `冷却至 ${formatAdminDate(row.cooldownEndsAt)}` : row.status === "REJOIN_REJECTED" && row.rejoinRetryAt ? `可再次申请：${formatAdminDate(row.rejoinRetryAt)}` : ""}</small></div><span className={`status-chip ${row.status === "ACTIVE" ? "success" : "warning"}`}>{clearanceStatusLabel(row.status)}</span></article>)}</div>}
    </>}
  </section>;
}

function SettingsAdmin() {
  const [rows, setRows] = useState<OperationSwitchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/operation-switches", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "运营开关加载失败");
        setRows(result.switches ?? []);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "运营开关加载失败"))
      .finally(() => setLoading(false));
  }, []);

  async function toggle(row: OperationSwitchRow) {
    setSavingKey(row.key);
    setError("");
    try {
      const response = await fetch("/api/admin/operation-switches", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: row.key, enabled: !row.enabled }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "运营开关更新失败");
      setRows(result.switches ?? []);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "运营开关更新失败");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <>
      <div className="admin-page-title"><div><span className="eyebrow">OPERATIONS CONTROL</span><h1>系统设置</h1><p>紧急情况下暂停成员写入入口，不影响后台处理和历史数据。</p></div><span className="status-chip success"><ShieldCheck size={14} /> 服务端强制</span></div>
      <section className="admin-panel operation-settings-panel">
        <div className="admin-panel-head"><div><h2>运营开关</h2><p>每次变更都会记录操作者、时间和开关前后状态</p></div></div>
        {loading && <p className="empty-copy">正在加载运营开关...</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {!loading && <div className="operation-switch-list">{rows.map((row) => (
          <div className="operation-switch-row" key={row.key}>
            <div><strong>{row.label}</strong><span>{row.description}</span><small>{row.updatedAt ? `最近更新：${formatAdminDate(row.updatedAt)}${row.updatedBy ? ` · ${row.updatedBy.nickname}` : ""}` : "使用系统默认配置"}</small></div>
            <label className="operation-toggle">
              <input type="checkbox" checked={row.enabled} disabled={Boolean(savingKey)} onChange={() => void toggle(row)} />
              <span aria-hidden="true" />
              <b>{savingKey === row.key ? "保存中" : row.enabled ? "已开启" : "已暂停"}</b>
            </label>
          </div>
        ))}</div>}
      </section>
      <MemberClearanceSettings />
      <section className="admin-panel operation-settings-panel">
        <div className="admin-panel-head"><div><h2>脱敏数据导出</h2><p>导出文件不包含手机号、地址、收款码、密码或原始抓取数据。</p></div></div>
        <div className="export-link-grid">
          <a className="secondary-button" href="/api/admin/exports/orders"><Download size={16} />订单 CSV</a>
          <a className="secondary-button" href="/api/admin/exports/points"><Download size={16} />积分 CSV</a>
          <a className="secondary-button" href="/api/admin/exports/videos"><Download size={16} />视频 CSV</a>
          <a className="secondary-button" href="/api/admin/exports/audit"><Download size={16} />审计 CSV</a>
        </div>
      </section>
    </>
  );
}

function auditRoleLabel(role: string) {
  return role === "ADMIN" ? "管理员" : role === "REVIEWER" ? "审核员" : "成员";
}

function AdminMobileNav({ active, open, onClose, onChange }: { active: AdminSection; open: boolean; onClose: () => void; onChange: (section: AdminSection) => void }) {
  if (!open) return null;
  const items: Array<{ id: AdminSection; label: string }> = [
    { id: "workbench", label: "运营工作台" }, { id: "videos", label: "视频与申诉" }, { id: "users", label: "用户与公会" }, { id: "points", label: "积分管理" }, { id: "gifts", label: "礼品管理" }, { id: "orders", label: "兑换订单" }, { id: "rankings", label: "榜单结算" }, { id: "challenges", label: "AI 周挑战" }, { id: "announcements", label: "公告通知" }, { id: "logs", label: "审计日志" }, { id: "settings", label: "系统设置" },
  ];
  return <div className="admin-mobile-nav-backdrop" role="presentation" onMouseDown={onClose}><nav className="admin-mobile-nav" aria-label="管理后台导航" onMouseDown={(event) => event.stopPropagation()}><header><strong>管理后台</strong><button className="icon-button" aria-label="关闭菜单" onClick={onClose}><X size={18} /></button></header>{items.map((item) => <button className={active === item.id ? "active" : ""} key={item.id} onClick={() => { onChange(item.id); onClose(); }}>{item.label}</button>)}</nav></div>;
}

function auditActorLabel(row: AdminAuditRow) {
  if (row.actor) return row.actor.nickname;
  if (["VIDEO_AUTO_REJECTED", "VIDEO_WORKER_RECOVERY", "VIDEO_REPROCESS_REQUESTED", "VIDEO_BULK_REPROCESS_REQUESTED", "VIDEO_ENQUEUE_FAILED", "VIDEO_REPROCESS_ENQUEUE_FAILED", "VIDEO_APPROVED", "VIDEO_POINTS_ADJUSTED", "VIDEO_SECONDARY_REVIEW_CREATED", "REDEMPTION_RECONCILIATION_COMPLETED", "RANKING_SETTLED"].includes(row.action)) return "系统自动任务";
  if (row.action === "LOGIN_FAILED") return "未登录用户";
  return "历史详情有限";
}

function LogsAdmin({ rows, pagination, onLoadMore, onSearch, onFilter }: { rows: AdminAuditRow[]; pagination: AdminPagination; onLoadMore: () => Promise<void>; onSearch: (query: string) => Promise<void>; onFilter: (filters: { actionPrefix: string; entity: string }) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [actionPrefix, setActionPrefix] = useState("");
  const [entity, setEntity] = useState("");
  const [selected, setSelected] = useState<AdminAuditRow | null>(null);
  async function submitSearch() {
    await onSearch(query.trim());
  }
  return (
    <>
      <div className="admin-page-title"><div><span className="eyebrow">AUDIT TRAIL</span><h1>审计日志</h1><p>所有写入、身份和订单变更都在这里留痕。</p></div><button className="icon-button" title="只读日志" aria-label="只读日志"><SlidersHorizontal size={19} /></button></div>
      <section className="admin-panel audit-panel"><div className="admin-panel-head"><div><h2>系统操作记录</h2><p>只读记录 · 共 {pagination.total} 条，当前第 {pagination.page} / {pagination.pages} 页</p></div><div className="table-actions"><div className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitSearch(); }} placeholder="搜索操作人、对象、原因或请求 ID" /><button className="icon-button" title="执行搜索" aria-label="执行搜索" onClick={() => void submitSearch()}><Search size={18} /></button></div><select className="audit-filter" value={actionPrefix} aria-label="按动作筛选" onChange={(event) => { const value = event.target.value; setActionPrefix(value); void onFilter({ actionPrefix: value, entity }); }}><option value="">全部动作</option><option value="VIDEO_">视频</option><option value="REDEMPTION_">兑换</option><option value="TRANSFER_">转账</option><option value="LOGIN_">登录</option><option value="USER_">成员</option><option value="GIFT_">礼品</option><option value="RANKING_">榜单</option><option value="ANNOUNCEMENT_">公告</option></select><select className="audit-filter" value={entity} aria-label="按对象筛选" onChange={(event) => { const value = event.target.value; setEntity(value); void onFilter({ actionPrefix, entity: value }); }}><option value="">全部对象</option><option value="VideoSubmission">视频</option><option value="VideoAppeal">视频申诉</option><option value="RedemptionOrder">兑换订单</option><option value="Transfer">转账</option><option value="PointLedger">积分流水</option><option value="PasswordResetRequest">密码找回申请</option><option value="User">成员</option><option value="Gift">礼品</option><option value="RankingAward">榜单奖励</option><option value="Announcement">公告</option><option value="Authentication">认证</option></select></div></div><div className="data-table-wrap"><table className="data-table audit-log-table"><thead><tr><th>操作摘要</th><th>操作人</th><th>对象</th><th>时间</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><span className="log-action"><ShieldCheck size={15} />{row.actionLabel}</span><small className="audit-summary">{row.summary}</small></td><td>{auditActorLabel(row)}<small>{row.actor ? `${row.actor.kuaishouId} · ${auditRoleLabel(row.actor.role)}` : row.action === "LOGIN_FAILED" ? "登录安全事件" : row.action.startsWith("VIDEO_") ? "系统事件" : "历史详情有限"}</small></td><td><span>{row.entityLabel}</span><small>{row.entityId ?? "—"}</small></td><td>{formatAdminDate(row.createdAt)}</td><td><button className="table-more" title="查看日志详情" aria-label={`查看${row.actionLabel}详情`} onClick={() => setSelected(row)}><FileText size={15} /></button></td></tr>)}</tbody></table></div>{rows.length === 0 && <p className="empty-copy">暂无审计记录</p>}{pagination.page < pagination.pages && <div className="admin-panel-actions"><button className="secondary-button" onClick={() => void onLoadMore()}>加载更多日志 <ChevronDown size={15} /></button></div>}</section>
      {selected && <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelected(null)}><section className="modal-sheet audit-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">AUDIT DETAIL</span><h2 id="audit-detail-title">{selected.actionLabel}</h2></div><button className="icon-button" aria-label="关闭日志详情" onClick={() => setSelected(null)}><X size={20} /></button></div><p className="audit-detail-summary">{selected.summary}</p><div className="audit-detail-grid"><div><span>操作人</span><strong>{auditActorLabel(selected)}</strong></div><div><span>角色</span><strong>{selected.actor ? auditRoleLabel(selected.actor.role) : selected.action.startsWith("VIDEO_") || selected.action === "RANKING_SETTLED" || selected.action === "REDEMPTION_RECONCILIATION_COMPLETED" ? "系统" : "资料有限"}</strong></div><div><span>对象</span><strong>{selected.entityLabel} · {selected.entityId ?? "—"}</strong></div><div><span>时间</span><strong>{formatAdminDate(selected.createdAt)}</strong></div><div><span>IP</span><strong>{selected.ip ?? "—"}</strong></div><div><span>请求 ID</span><strong>{selected.requestId ?? "—"}</strong></div></div><div className="audit-json-grid"><div><span>变更前</span><pre>{auditJson(selected.beforeValue)}</pre></div><div><span>变更后</span><pre>{auditJson(selected.afterValue)}</pre></div></div>{selected.reason && <div className="audit-reason"><span>原因</span><p>{selected.reason}</p></div>}<small className="audit-raw-action">原始动作码：{selected.action}</small></section></div>}
    </>
  );
}

function AdminModuleState({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  return (
    <section className="admin-module-state" role={error ? "alert" : "status"} aria-live="polite">
      {error ? <AlertTriangle size={24} /> : <Activity size={24} />}
      <strong>{error || "正在加载当前模块..."}</strong>
      {error && <button className="primary-button" onClick={onRetry}>重新加载</button>}
      {loading && !error && <span className="admin-module-loading" aria-hidden="true" />}
    </section>
  );
}

export default function AdminPage() {
  const [active, setActive] = useState<AdminSection>("workbench");
  const [navigationTarget, setNavigationTarget] = useState<{ section: AdminSection; filter?: string } | null>(null);
  const [activityTarget, setActivityTarget] = useState<{ entity: string; entityId: string; title: string } | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [giftEditor, setGiftEditor] = useState<{ gift: AdminGiftRow | null } | null>(null);
  const [giftActionId, setGiftActionId] = useState<string | null>(null);
  const [videoFilters, setVideoFilters] = useState({ search: "", status: "" });
  const [secondaryReviewStatus, setSecondaryReviewStatus] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const [appealSearch, setAppealSearch] = useState("");
  const [userFilters, setUserFilters] = useState({ search: "", guild: "" });
  const [pointUserSearch, setPointUserSearch] = useState("");
  const [orderFilters, setOrderFilters] = useState({ search: "", status: "" });
  const [auditSearch, setAuditSearch] = useState("");
  const [auditFilters, setAuditFilters] = useState({ actionPrefix: "", entity: "" });
  const [adminFeedback, setAdminFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [loadedSections, setLoadedSections] = useState<Partial<Record<AdminSection, boolean>>>({});
  const [sectionStatus, setSectionStatus] = useState<Partial<Record<AdminSection, { loading: boolean; error: string }>>>({});
  const loadingSections = useRef(new Set<AdminSection>());
  const { ask: askAdminValue, dialog: adminPromptDialog } = useAdminPrompt();
  const router = useRouter();
  function changeSection(section: AdminSection, filter?: string) {
    const params = new URLSearchParams();
    params.set("section", section);
    if (filter) params.set("filter", filter);
    router.replace(`/admin?${params.toString()}`, { scroll: false });
    setActive(section);
    setNavigationTarget(filter ? { section, filter } : null);
  }
  useEffect(() => {
    const syncLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("section");
      const section = adminSections.includes(requested as AdminSection) ? requested as AdminSection : "workbench";
      setActive(section);
      const filter = params.get("filter")?.trim() || undefined;
      setNavigationTarget(filter ? { section, filter } : null);
    };
    syncLocation();
    window.addEventListener("popstate", syncLocation);
    return () => window.removeEventListener("popstate", syncLocation);
  }, []);
  useEffect(() => {
    let activeRequest = true;
    fetch("/api/admin/dashboard", { cache: "no-store" }).then(async (dashboardResponse) => {
      if (dashboardResponse.status === 401 || dashboardResponse.status === 403) {
        router.replace("/login");
        return;
      }
      const dashboard = await dashboardResponse.json();
      if (!dashboardResponse.ok) throw new Error(dashboard.error ?? "后台数据加载失败");
      if (activeRequest) {
        setData(initialAdminData(dashboard));
        setLoadedSections({ overview: true });
      }
    }).catch((loadError) => {
      if (activeRequest) setError(loadError instanceof Error ? loadError.message : "后台数据加载失败");
    });
    return () => { activeRequest = false; };
  }, [router]);
  async function ensureSectionLoaded(section: AdminSection, force = false) {
    if (!data || (!force && loadedSections[section]) || loadingSections.current.has(section)) return;
    loadingSections.current.add(section);
    setSectionStatus((current) => ({ ...current, [section]: { loading: true, error: "" } }));
    try {
      const payload = await loadAdminSection(section);
      setData((current) => {
        if (!current) return current;
        if (section === "overview") {
          const dashboard = payload.dashboard as { metrics: AdminData["metrics"]; pointsTrend?: AdminData["pointsTrend"]; audit?: AdminAuditRow[]; recentVideos?: AdminVideo[]; memberGrowth?: AdminMemberGrowth };
          return { ...current, metrics: dashboard.metrics, pointsTrend: dashboard.pointsTrend ?? [], audit: dashboard.audit ?? current.audit, recentVideos: dashboard.recentVideos ?? current.recentVideos, memberGrowth: dashboard.memberGrowth ?? null };
        }
        if (section === "videos") {
          const reviews = payload.reviews as { reviews?: AdminSecondaryReview[]; pagination?: AdminPagination };
          const videos = payload.videos as { videos?: AdminVideo[]; pagination?: AdminPagination };
          const appeals = payload.appeals as { appeals?: AdminAppeal[]; pagination?: AdminPagination };
          return {
            ...current,
            secondaryReviews: reviews.reviews ?? [],
            secondaryReviewsPagination: reviews.pagination ?? emptyPagination,
            videos: videos.videos ?? [],
            videosPagination: videos.pagination ?? emptyPagination,
            appeals: appeals.appeals ?? [],
            appealsPagination: appeals.pagination ?? emptyPagination,
          };
        }
        if (section === "users") {
          const users = payload.users as { users?: AdminUserRow[]; pagination?: AdminPagination };
          return { ...current, users: users.users ?? [], usersPagination: users.pagination ?? emptyPagination };
        }
        if (section === "points") {
          const users = payload.users as { users?: AdminUserRow[]; pagination?: AdminPagination };
          const points = payload.points as { ledger?: AdminPointLedgerRow[]; pagination?: AdminPagination };
          const pointRules = payload.pointRules as { rule?: VideoPointRule };
          return { ...current, pointUsers: users.users ?? [], pointUsersPagination: users.pagination ?? emptyPagination, pointLedger: points.ledger ?? [], pointPagination: points.pagination ?? emptyPagination, pointRule: pointRules.rule ?? defaultPointRule };
        }
        if (section === "gifts") {
          const gifts = payload.gifts as { gifts?: AdminGiftRow[] };
          const orders = payload.orders as { orders?: AdminOrderRow[]; pagination?: AdminPagination };
          return { ...current, gifts: gifts.gifts ?? [], orders: orders.orders ?? [], ordersPagination: orders.pagination ?? emptyPagination };
        }
        if (section === "orders") {
          const orders = payload.orders as { orders?: AdminOrderRow[]; pagination?: AdminPagination };
          return { ...current, orders: orders.orders ?? [], ordersPagination: orders.pagination ?? emptyPagination };
        }
        if (section === "rankings") {
          const rankings = payload.rankings as { periods?: AdminRankingPeriod[] };
          return { ...current, periods: rankings.periods ?? [] };
        }
        if (section === "challenges") {
          const weeklyChallenges = payload.weeklyChallenges as { periods?: AdminWeeklyChallengePeriod[] };
          return { ...current, weeklyChallengePeriods: weeklyChallenges.periods ?? [] };
        }
        if (section === "announcements") {
          const announcements = payload.announcements as { announcements?: AdminAnnouncement[] };
          const users = payload.users as { users?: AdminUserRow[]; pagination?: AdminPagination };
          return { ...current, announcements: announcements.announcements ?? [], announcementUsers: users.users ?? [] };
        }
        if (section === "logs") {
          const audit = payload.audit as { audit?: AdminAuditRow[]; pagination?: AdminPagination };
          return { ...current, audit: audit.audit ?? [], auditPagination: audit.pagination ?? emptyPagination };
        }
        return current;
      });
      setLoadedSections((current) => ({ ...current, [section]: true }));
      setSectionStatus((current) => ({ ...current, [section]: { loading: false, error: "" } }));
    } catch (loadError) {
      if (loadError instanceof AdminFetchError && [401, 403].includes(loadError.status)) router.replace("/login");
      setSectionStatus((current) => ({ ...current, [section]: { loading: false, error: loadError instanceof Error ? loadError.message : "模块加载失败" } }));
    } finally {
      loadingSections.current.delete(section);
    }
  }
  useEffect(() => {
    if (data && !loadedSections[active]) void ensureSectionLoaded(active);
  }, [active, data, loadedSections]);
  function invalidateOverview() {
    setLoadedSections((current) => ({ ...current, overview: false }));
  }
  async function fetchAdminPage(path: string, fallbackMessage: string) {
    const response = await fetch(path, { cache: "no-store" });
    const result = await response.json();
    if (response.status === 401 || response.status === 403) router.replace("/login");
    if (!response.ok) throw new Error(result.error ?? fallbackMessage);
    return result;
  }
  async function saveAnnouncement(input: { id?: string; title: string; content: string; audience: "ALL" | "SELECTED"; recipientIds?: string[] }) {
    const response = await fetch(input.id ? `/api/admin/announcements/${input.id}` : "/api/admin/announcements", {
      method: input.id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.id ? { action: "update", ...input } : input),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "公告保存失败");
    const announcement = result.announcement as AdminAnnouncement;
    setData((current) => current ? {
      ...current,
      announcements: input.id ? current.announcements.map((row) => row.id === input.id ? announcement : row) : [announcement, ...current.announcements],
    } : current);
    return announcement;
  }
  async function actionAnnouncement(id: string, action: "publish" | "withdraw") {
    const response = await fetch(`/api/admin/announcements/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "公告操作失败");
    const announcement = result.announcement as AdminAnnouncement;
    setData((current) => current ? { ...current, announcements: current.announcements.map((row) => row.id === id ? { ...row, ...announcement } : row) } : current);
  }
  async function loadSecondaryReviews(input: { page?: number; status?: "PENDING" | "APPROVED" | "REJECTED"; append?: boolean }) {
    if (!data) return;
    const status = input.status ?? secondaryReviewStatus;
    const page = input.page ?? 1;
    const params = new URLSearchParams({ page: String(page), take: String(data.secondaryReviewsPagination.take), status });
    try {
      const result = await fetchAdminPage(`/api/reviewer/video-reviews?${params}`, "二次审核池加载失败");
      setSecondaryReviewStatus(status);
      setData((current) => current ? {
        ...current,
        secondaryReviews: input.append ? [...current.secondaryReviews, ...(result.reviews ?? [])] : (result.reviews ?? []),
        secondaryReviewsPagination: result.pagination,
      } : current);
    } catch (loadError) {
      setAdminFeedback({ type: "error", message: loadError instanceof Error ? loadError.message : "二次审核池加载失败" });
    }
  }
  async function loadMoreSecondaryReviews() {
    if (!data || data.secondaryReviewsPagination.page >= data.secondaryReviewsPagination.pages) return;
    await loadSecondaryReviews({ page: data.secondaryReviewsPagination.page + 1, append: true });
  }
  async function loadVideos(input: { page?: number; search?: string; status?: string; append?: boolean }) {
    if (!data) return;
    const nextFilters = {
      search: input.search ?? videoFilters.search,
      status: input.status ?? videoFilters.status,
    };
    const page = input.page ?? 1;
    const params = new URLSearchParams({ page: String(page), take: String(data.videosPagination.take) });
    if (nextFilters.search) params.set("search", nextFilters.search);
    if (nextFilters.status) params.set("status", nextFilters.status);
    try {
      const result = await fetchAdminPage(`/api/admin/videos?${params}`, "视频记录加载失败");
      setVideoFilters(nextFilters);
      setData((current) => current ? {
        ...current,
        videos: input.append ? [...current.videos, ...(result.videos ?? [])] : (result.videos ?? []),
        videosPagination: result.pagination,
      } : current);
    } catch (loadError) {
      setAdminFeedback({ type: "error", message: loadError instanceof Error ? loadError.message : "视频记录加载失败" });
    }
  }
  async function loadMoreVideos() {
    if (!data || data.videosPagination.page >= data.videosPagination.pages) return;
    await loadVideos({ page: data.videosPagination.page + 1, append: true });
  }
  async function loadAppeals(input: { page?: number; search?: string; append?: boolean }) {
    if (!data) return;
    const search = input.search ?? appealSearch;
    const page = input.page ?? 1;
    const params = new URLSearchParams({ page: String(page), take: String(data.appealsPagination.take) });
    if (search) params.set("search", search);
    try {
      const result = await fetchAdminPage(`/api/admin/video-appeals?${params}`, "申诉记录加载失败");
      setAppealSearch(search);
      setData((current) => current ? {
        ...current,
        appeals: input.append ? [...current.appeals, ...(result.appeals ?? [])] : (result.appeals ?? []),
        appealsPagination: result.pagination,
      } : current);
    } catch (loadError) {
      setAdminFeedback({ type: "error", message: loadError instanceof Error ? loadError.message : "申诉记录加载失败" });
    }
  }
  async function loadMoreAppeals() {
    if (!data || data.appealsPagination.page >= data.appealsPagination.pages) return;
    await loadAppeals({ page: data.appealsPagination.page + 1, append: true });
  }
  async function loadUsers(input: { page?: number; search?: string; guild?: string; append?: boolean }) {
    if (!data) return;
    const nextFilters = {
      search: input.search ?? userFilters.search,
      guild: input.guild ?? userFilters.guild,
    };
    const page = input.page ?? 1;
    const params = new URLSearchParams({ page: String(page), take: String(data.usersPagination.take) });
    if (nextFilters.search) params.set("search", nextFilters.search);
    if (nextFilters.guild) params.set("guild", nextFilters.guild);
    try {
      const result = await fetchAdminPage(`/api/admin/users?${params}`, "成员记录加载失败");
      setUserFilters(nextFilters);
      setData((current) => current ? {
        ...current,
        users: input.append ? [...current.users, ...(result.users ?? [])] : (result.users ?? []),
        usersPagination: result.pagination,
      } : current);
    } catch (loadError) {
      setAdminFeedback({ type: "error", message: loadError instanceof Error ? loadError.message : "成员记录加载失败" });
    }
  }
  async function loadMoreUsers() {
    if (!data || data.usersPagination.page >= data.usersPagination.pages) return;
    await loadUsers({ page: data.usersPagination.page + 1, append: true });
  }
  async function loadPointUsers(input: { page?: number; search?: string; append?: boolean }) {
    if (!data) return;
    const search = input.search ?? pointUserSearch;
    const page = input.page ?? 1;
    try {
      const result = await fetchAdminPage(buildAdminUsersPath({ page, take: data.pointUsersPagination.take, search }), "成员记录加载失败");
      setPointUserSearch(search);
      setData((current) => current ? {
        ...current,
        pointUsers: input.append ? [...current.pointUsers, ...(result.users ?? [])] : (result.users ?? []),
        pointUsersPagination: result.pagination,
      } : current);
    } catch (loadError) {
      setAdminFeedback({ type: "error", message: loadError instanceof Error ? loadError.message : "成员记录加载失败" });
    }
  }
  async function loadMorePointUsers() {
    if (!data || data.pointUsersPagination.page >= data.pointUsersPagination.pages) return;
    await loadPointUsers({ page: data.pointUsersPagination.page + 1, append: true });
  }
  async function loadOrders(input: { page?: number; search?: string; status?: string; append?: boolean }) {
    if (!data) return;
    const nextFilters = {
      search: input.search ?? orderFilters.search,
      status: input.status ?? orderFilters.status,
    };
    const page = input.page ?? 1;
    const params = new URLSearchParams({ page: String(page), take: String(data.ordersPagination.take) });
    if (nextFilters.search) params.set("search", nextFilters.search);
    if (nextFilters.status) params.set("status", nextFilters.status);
    try {
      const result = await fetchAdminPage(`/api/admin/orders?${params}`, "订单记录加载失败");
      setOrderFilters(nextFilters);
      setData((current) => current ? {
        ...current,
        orders: input.append ? [...current.orders, ...(result.orders ?? [])] : (result.orders ?? []),
        ordersPagination: result.pagination,
      } : current);
    } catch (loadError) {
      setAdminFeedback({ type: "error", message: loadError instanceof Error ? loadError.message : "订单记录加载失败" });
    }
  }
  async function loadMoreOrders() {
    if (!data || data.ordersPagination.page >= data.ordersPagination.pages) return;
    await loadOrders({ page: data.ordersPagination.page + 1, append: true });
  }
  async function loadMoreAudit() {
    if (!data || data.auditPagination.page >= data.auditPagination.pages) return;
    await loadAudit({ page: data.auditPagination.page + 1, append: true });
  }
  async function loadAudit(input: { page?: number; search?: string; actionPrefix?: string; entity?: string; append?: boolean }) {
    if (!data) return;
    const search = input.search ?? auditSearch;
    const nextFilters = {
      actionPrefix: input.actionPrefix ?? auditFilters.actionPrefix,
      entity: input.entity ?? auditFilters.entity,
    };
    const page = input.page ?? 1;
    const params = new URLSearchParams({ page: String(page), take: String(data.auditPagination.take) });
    if (search) params.set("search", search);
    if (nextFilters.actionPrefix) params.set("actionPrefix", nextFilters.actionPrefix);
    if (nextFilters.entity) params.set("entity", nextFilters.entity);
    try {
      const result = await fetchAdminPage(`/api/admin/audit-logs?${params}`, "审计日志加载失败");
      setAuditSearch(search);
      setAuditFilters(nextFilters);
      setData((current) => current ? {
        ...current,
        audit: input.append ? [...current.audit, ...(result.audit ?? [])] : (result.audit ?? []),
        auditPagination: result.pagination,
      } : current);
    } catch (loadError) {
      setAdminFeedback({ type: "error", message: loadError instanceof Error ? loadError.message : "审计日志加载失败" });
    }
  }
  async function handleSecondaryReviewAction(review: AdminSecondaryReview, action: "approve" | "reject") {
    const reason = action === "reject" ? await askAdminValue({
      title: "二审驳回视频",
      label: "驳回原因",
      multiline: true,
      placeholder: "说明二审驳回依据，系统会扣回该视频已到账积分",
      confirmLabel: "确认驳回",
    }) : undefined;
    if (action === "reject" && !reason) return;
    const confirmed = await askAdminValue({
      title: action === "approve" ? "确认二审通过" : "确认二审驳回",
      label: action === "approve" ? "通过后该视频不再留在待二审池。" : `将扣回 ${review.video.points.toLocaleString()} 积分，并重新核对关联挑战奖励。`,
      required: false,
      confirmLabel: action === "approve" ? "确认通过" : "确认驳回",
    });
    if (confirmed === null) return;
    const response = await fetch(`/api/reviewer/video-reviews/${review.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    const result = await response.json();
    if (!response.ok) {
      setAdminFeedback({ type: "error", message: result.error ?? "二次审核操作失败" });
      return;
    }
    setAdminFeedback({ type: "success", message: action === "approve" ? "二审已通过" : "二审已驳回，积分已扣回" });
    setData((current) => {
      if (!current) return current;
      const updated = result.review as AdminSecondaryReview;
      const remainsVisible = updated.status === secondaryReviewStatus;
      return {
        ...current,
        metrics: {
          ...current.metrics,
          pendingVideos: review.status === "PENDING" ? Math.max(0, current.metrics.pendingVideos - 1) : current.metrics.pendingVideos,
          pendingSecondaryReviews: review.status === "PENDING" ? Math.max(0, (current.metrics.pendingSecondaryReviews ?? 0) - 1) : current.metrics.pendingSecondaryReviews,
        },
        secondaryReviews: remainsVisible
          ? current.secondaryReviews.map((item) => item.id === review.id ? updated : item)
          : current.secondaryReviews.filter((item) => item.id !== review.id),
        secondaryReviewsPagination: remainsVisible
          ? current.secondaryReviewsPagination
          : { ...current.secondaryReviewsPagination, total: Math.max(0, current.secondaryReviewsPagination.total - 1) },
        videos: action === "reject"
          ? current.videos.map((item) => item.id === review.video.id ? { ...item, status: "REVOKED", reviewReason: reason ?? item.reviewReason } : item)
          : current.videos,
      };
    });
    invalidateOverview();
  }
  async function handleVideoAction(video: AdminVideo, action: "revoke" | "reprocess") {
    const reason = action === "revoke" ? await askAdminValue({
      title: "撤销视频奖励",
      label: "撤销原因",
      multiline: true,
      placeholder: "说明撤销依据，操作会同步检查周挑战奖励",
      confirmLabel: "确认撤销",
    }) : undefined;
    if (action === "revoke" && !reason) return;
    const confirmed = await askAdminValue({
      title: action === "revoke" ? "确认撤销视频奖励" : "确认重新抓取视频",
      label: action === "revoke" ? `将扣回 ${video.points.toLocaleString()} 积分，并重新核对关联挑战奖励。` : "将把视频重新放入自动处理队列，历史记录会保留。",
      required: false,
      confirmLabel: action === "revoke" ? "确认撤销" : "确认重抓",
    });
    if (confirmed === null) return;
    const response = await fetch(`/api/videos/${video.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, reason, points: video.points }),
    });
    const result = await response.json();
    if (!response.ok) {
      setAdminFeedback({ type: "error", message: result.error ?? "操作失败" });
      return;
    }
    setAdminFeedback({ type: "success", message: action === "revoke" ? "视频奖励已撤销并完成相关积分核对" : "视频已重新进入处理队列" });
    setData((current) => {
      if (!current) return current;
      const nextStatus = result.video?.status as string | undefined;
      const remainsVisible = nextStatus !== undefined
        && (!videoFilters.status || videoFilters.status === nextStatus)
        && ["APPROVED", "REJECTED", "REVOKED", "FAILED"].includes(nextStatus);
      return {
        ...current,
        videos: remainsVisible
          ? current.videos.map((item) => item.id === video.id ? { ...item, ...result.video } : item)
          : current.videos.filter((item) => item.id !== video.id),
        videosPagination: remainsVisible
          ? current.videosPagination
          : { ...current.videosPagination, total: Math.max(0, current.videosPagination.total - 1) },
      };
    });
    invalidateOverview();
  }
  async function handleAppealAction(appeal: AdminAppeal, action: "approve" | "reject") {
    const reason = await askAdminValue(action === "reject" ? {
      title: "驳回视频申诉",
      label: "驳回原因",
      multiline: true,
      confirmLabel: "确认驳回",
    } : {
      title: "通过视频申诉",
      label: "复查说明（可选）",
      multiline: true,
      required: false,
      confirmLabel: "下一步",
    });
    if (reason === null) return;
    if (action === "reject" && !reason) return;
    let points: number | undefined;
    if (action === "approve") {
      const raw = await askAdminValue({
        title: "核定申诉积分",
        label: `当前抓取点赞 ${appeal.video.likes ?? 0}，请输入核定积分`,
        inputType: "number",
        initialValue: String(appeal.video.points || ""),
        required: false,
        confirmLabel: "确认通过",
      });
      if (raw === null) return;
      if (raw !== null && raw.trim() !== "") {
        points = Number(raw);
        if (!Number.isInteger(points) || points < 0) {
          setAdminFeedback({ type: "error", message: "积分必须是非负整数" });
          return;
        }
      }
    }
    const confirmed = await askAdminValue({
      title: action === "approve" ? "确认通过视频申诉" : "确认驳回视频申诉",
      label: action === "approve" ? `将为 ${appeal.user.nickname} 入账 ${points ?? appeal.video.points ?? 0} 积分，并写入审计记录。` : "将保留原自动驳回结果，并向成员发送处理结果。",
      required: false,
      confirmLabel: action === "approve" ? "确认通过并入账" : "确认驳回",
    });
    if (confirmed === null) return;
    const response = await fetch(`/api/admin/video-appeals/${appeal.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, reason, points }),
    });
    const result = await response.json();
    if (!response.ok) {
      setAdminFeedback({ type: "error", message: result.error ?? "申诉处理失败" });
      return;
    }
    setAdminFeedback({ type: "success", message: action === "approve" ? "申诉已通过并完成积分入账" : "申诉已驳回" });
    setData((current) => current ? {
      ...current,
      appeals: current.appeals.filter((item) => item.id !== appeal.id),
      appealsPagination: { ...current.appealsPagination, total: Math.max(0, current.appealsPagination.total - 1) },
      metrics: { ...current.metrics, pendingVideos: Math.max(0, current.metrics.pendingVideos - 1) },
    } : current);
    invalidateOverview();
  }
  async function handleOrderAction(order: AdminOrderRow, action: "approve" | "fulfill" | "update_tracking" | "reject" | "refund", input?: { trackingNumber?: string | null }): Promise<boolean> {
    const reason = ["reject", "refund"].includes(action) ? await askAdminValue({
      title: action === "reject" ? "驳回兑换订单" : "退款兑换订单",
      label: "处理原因",
      multiline: true,
      confirmLabel: action === "reject" ? "确认驳回" : "确认退款",
    }) : undefined;
    if (["reject", "refund"].includes(action) && !reason) return false;
    if (["fulfill", "reject", "refund"].includes(action)) {
      const confirmed = await askAdminValue({
        title: action === "fulfill" ? "确认完成订单履约" : action === "reject" ? "确认驳回订单" : "确认退款订单",
        label: action === "fulfill" ? `将把“${order.gift.name}”标记为已履约。` : `将变更“${order.gift.name}”的订单状态${action === "reject" || action === "refund" ? "并退回积分与库存" : ""}。`,
        required: false,
        confirmLabel: "确认操作",
      });
      if (confirmed === null) return false;
    }
    const response = await fetch(`/api/admin/orders/${order.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, reason, ...input }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error ?? "订单操作失败");
    }
    setData((current) => current ? {
      ...current,
        orders: current.orders.map((item) => item.id === order.id ? {
          ...item,
          status: result.order.status,
          trackingNumber: result.order.trackingNumber ?? item.trackingNumber ?? null,
          fulfilledAt: result.order.fulfilledAt ?? item.fulfilledAt ?? null,
        } : item),
        metrics: { ...current.metrics, pendingOrders: ["approve", "fulfill", "reject", "refund"].includes(action) && ["PENDING", "APPROVED"].includes(order.status) ? Math.max(0, current.metrics.pendingOrders - 1) : current.metrics.pendingOrders },
    } : current);
    invalidateOverview();
    return true;
  }
  async function handleUserUpdate(user: AdminUserRow, input: { active?: boolean; role?: "MEMBER" | "REVIEWER" | "ADMIN"; guildStatus?: string }) {
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok) {
      setAdminFeedback({ type: "error", message: result.error ?? "更新失败" });
      return;
    }
    setData((current) =>
      current
        ? {
            ...current,
            users: current.users.map((item) => item.id === user.id ? { ...item, active: result.user.active, role: result.user.role, guildStatus: result.user.guildStatus } : item),
            pointUsers: current.pointUsers.map((item) => item.id === user.id ? { ...item, active: result.user.active, role: result.user.role, guildStatus: result.user.guildStatus } : item),
            announcementUsers: current.announcementUsers.map((item) => item.id === user.id ? { ...item, active: result.user.active, role: result.user.role, guildStatus: result.user.guildStatus } : item),
          }
        : current,
    );
    invalidateOverview();
  }
  async function handleUserToggle(user: AdminUserRow) {
    await handleUserUpdate(user, { active: !user.active });
  }
  async function handleResetPassword(user: AdminUserRow) {
    const password = await askAdminValue({
      title: `重置 ${user.nickname} 的密码`,
      label: "临时密码（至少 8 位）",
      inputType: "password",
      confirmLabel: "确认重置",
    });
    if (!password) return;
    const response = await fetch(`/api/admin/users/${user.id}/password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json();
    if (!response.ok) {
      setAdminFeedback({ type: "error", message: result.error ?? "密码重置失败" });
      return;
    }
    setAdminFeedback({ type: "success", message: "密码已重置，旧登录会话已失效。请通过安全方式将临时密码交给成员。" });
  }
  async function handleRankingSettle(type: "week" | "month", periodStart: string, rewards: Array<{ rank: number; title: string; description?: string }>) {
    const response = await fetch("/api/admin/rankings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "settle", type, periodStart, rewards }),
    });
    const result = await response.json();
    if (!response.ok) {
      setAdminFeedback({ type: "error", message: result.error ?? "榜单结算失败" });
      return;
    }
    const refreshed = await fetch("/api/admin/rankings", { cache: "no-store" });
    const rankings = await refreshed.json();
    setData((current) => current ? { ...current, periods: rankings.periods ?? [] } : current);
    setAdminFeedback({
      type: "success",
      message: result.settled ? "榜单已完成结算" : (result.reason ?? "该周期已结算"),
    });
  }
  async function handleRankingAwardUpdate(award: AdminRankingAward, input: { status?: "FULFILLED" }) {
    const response = await fetch(`/api/admin/rankings/awards/${award.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok) {
      setAdminFeedback({ type: "error", message: result.error ?? "奖励更新失败" });
      return;
    }
    const refreshed = await fetch("/api/admin/rankings", { cache: "no-store" });
    const rankings = await refreshed.json();
    setData((current) => current ? { ...current, periods: rankings.periods ?? [] } : current);
    setAdminFeedback({ type: "success", message: "榜单奖励状态已更新" });
  }
  async function handleWeeklyChallengeRetry(period: AdminWeeklyChallengePeriod) {
    try {
      const response = await fetch(`/api/admin/weekly-challenges/${period.id}/retry`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "周挑战重试提交失败");
      const refreshed = await fetchAdminPage("/api/admin/weekly-challenges?take=10", "周挑战周期刷新失败");
      setData((current) => current ? { ...current, weeklyChallengePeriods: refreshed.periods ?? [] } : current);
      setAdminFeedback({ type: "success", message: "周挑战重新生成任务已提交" });
    } catch (retryError) {
      setAdminFeedback({ type: "error", message: retryError instanceof Error ? retryError.message : "周挑战重试提交失败" });
    }
  }
  async function handleWeeklyChallengeUpgrade(period: AdminWeeklyChallengePeriod) {
    const response = await fetch(`/api/admin/weekly-challenges/${period.id}/upgrade-tiered-rewards`, {
      method: "POST",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "周挑战重新生成提交失败");
    const refreshed = await fetchAdminPage("/api/admin/weekly-challenges?take=10", "周挑战周期刷新失败");
    setData((current) => current ? { ...current, weeklyChallengePeriods: refreshed.periods ?? [] } : current);
    setAdminFeedback({
      type: "success",
      message: `已按 ${result.audienceCount} 名上周投稿成员提交重新生成；成功前旧任务不会发布`,
    });
  }
  async function handlePointAdjustment(input: { selectionMode: "EXPLICIT" | "ALL_ACTIVE_MEMBERS"; userIds?: string[]; amount: number; reason: string }) {
    const response = await fetch("/api/admin/points/bulk", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok) {
      const blockerText = Array.isArray(result.blockers) && result.blockers.length
        ? `：${result.blockers.map((blocker: { userId: string; reason: string }) => blocker.reason).join("、")}`
        : "";
      throw new Error(`${result.error ?? "积分调整失败"}${blockerText}`);
    }
    setData((current) => {
      if (!current) return current;
      const adjustments = result.adjustments as Array<{ userId: string; balance: number; ledger: AdminPointLedgerRow }>;
      return {
        ...current,
        metrics: { ...current.metrics, totalBalance: current.metrics.totalBalance + input.amount * adjustments.length },
        pointUsers: current.pointUsers.map((user) => {
          const adjustment = adjustments.find((row) => row.userId === user.id);
          return adjustment ? { ...user, account: { balance: adjustment.balance } } : user;
        }),
        pointLedger: [...adjustments.map((row) => row.ledger), ...current.pointLedger.filter((row) => !adjustments.some((item) => item.ledger.id === row.id))],
        pointPagination: { ...current.pointPagination, total: current.pointPagination.total + adjustments.length },
      };
    });
    invalidateOverview();
  }
  async function handlePointRuleSave(input: VideoPointRule) {
    const response = await fetch("/api/admin/point-rules", {
      method: "PATCH",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "积分规则保存失败");
    setData((current) => current ? { ...current, pointRule: result.rule } : current);
  }
  async function loadMorePointLedger() {
    if (!data || data.pointPagination.page >= data.pointPagination.pages) return;
    const nextPage = data.pointPagination.page + 1;
    const response = await fetch(`/api/admin/points?page=${nextPage}&take=${data.pointPagination.take}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "积分流水加载失败");
    setData((current) => current ? {
      ...current,
      pointLedger: [...current.pointLedger, ...(result.ledger ?? [])],
      pointPagination: result.pagination,
    } : current);
  }
  async function handleGiftSave(input: GiftEditorInput) {
    const gift = giftEditor?.gift;
    const response = await fetch(gift ? `/api/admin/gifts/${gift.id}` : "/api/admin/gifts", {
      method: gift ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "礼品保存失败");
    setData((current) => current ? {
      ...current,
       gifts: (gift ? current.gifts.map((item) => item.id === gift.id ? { ...item, ...result.gift } : item) : [...current.gifts, { ...result.gift, salesCount: 0 }]).sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.displayOrder - right.displayOrder),
    } : current);
    setAdminFeedback({ type: "success", message: gift ? "礼品修改已保存" : "礼品已创建" });
    invalidateOverview();
  }
  async function handleGiftTogglePin(gift: AdminGiftRow) {
    if (!data || giftActionId) return;
    setGiftActionId(gift.id);
    try {
      const response = await fetch(`/api/admin/gifts/${gift.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: !gift.pinned }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "置顶状态更新失败");
      setData((current) => current ? {
        ...current,
        gifts: current.gifts
          .map((item) => item.id === gift.id ? { ...item, ...result.gift } : item)
          .sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.displayOrder - right.displayOrder),
      } : current);
      setAdminFeedback({ type: "success", message: result.gift.pinned ? "商品已置顶" : "商品已取消置顶" });
    } catch (pinError) {
      setAdminFeedback({ type: "error", message: pinError instanceof Error ? pinError.message : "置顶状态更新失败" });
    } finally {
      setGiftActionId(null);
    }
  }
  async function handleGiftMove(gift: AdminGiftRow, direction: -1 | 1) {
    if (!data || giftActionId) return;
    const index = data.gifts.findIndex((item) => item.id === gift.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= data.gifts.length) return;
    if (data.gifts[target].pinned !== gift.pinned) return;
    const ordered = [...data.gifts];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setGiftActionId(gift.id);
    try {
      const response = await fetch("/api/admin/gifts/reorder", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderedIds: ordered.map((item) => item.id) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "礼品排序失败");
      setData((current) => current ? {
        ...current,
        gifts: result.gifts.map((item: AdminGiftRow) => ({
          ...item,
          salesCount: current.gifts.find((giftRow) => giftRow.id === item.id)?.salesCount ?? 0,
        })),
      } : current);
      setAdminFeedback({ type: "success", message: "成员商城商品顺序已更新" });
    } catch (moveError) {
      setAdminFeedback({ type: "error", message: moveError instanceof Error ? moveError.message : "礼品排序失败" });
    } finally {
      setGiftActionId(null);
    }
  }
  async function handleGiftDelete(gift: AdminGiftRow) {
    if (giftActionId || !window.confirm(`确认删除“${gift.name}”？历史兑换和榜单记录仍会保留。`)) return;
    setGiftActionId(gift.id);
    try {
      const response = await fetch(`/api/admin/gifts/${gift.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "礼品删除失败");
      setData((current) => current ? { ...current, gifts: current.gifts.filter((item) => item.id !== gift.id) } : current);
      setAdminFeedback({ type: "success", message: "礼品已删除，历史兑换记录已保留" });
      invalidateOverview();
    } catch (deleteError) {
      setAdminFeedback({ type: "error", message: deleteError instanceof Error ? deleteError.message : "礼品删除失败" });
    } finally {
      setGiftActionId(null);
    }
  }
  useEffect(() => {
    if (!navigationTarget || !data) return;
    const { section, filter } = navigationTarget;
    if (!filter) return;
    const search = filter.startsWith("search:") ? filter.slice("search:".length) : "";
    if (section === "users") { if (!loadedSections.users) return; if (search) void loadUsers({ search }); }
    if (section === "videos") { if (!loadedSections.videos) return; if (search) void loadVideos({ search }); }
    if (section === "orders") { if (!loadedSections.orders) return; void loadOrders(search ? { search } : { status: filter }); }
    if (section === "logs") { if (!loadedSections.logs) return; if (search) void loadAudit({ search }); }
    setNavigationTarget(null);
  }, [navigationTarget, data, loadedSections.users, loadedSections.videos, loadedSections.orders, loadedSections.logs]);
  const render = () => {
    if (!data) return null;
    if (active === "workbench") return <WorkbenchAdmin onNavigate={(section, filter) => changeSection(section as AdminSection, filter)} />;
    const status = sectionStatus[active];
    if (!loadedSections[active] && (status?.loading || status?.error)) {
      return <AdminModuleState loading={Boolean(status.loading)} error={status.error} onRetry={() => void ensureSectionLoaded(active, true)} />;
    }
    if (active === "videos") return <VideoManagement secondaryReviews={data.secondaryReviews} videos={data.videos} appeals={data.appeals} secondaryReviewsPagination={data.secondaryReviewsPagination} videosPagination={data.videosPagination} appealsPagination={data.appealsPagination} onSecondaryReviewAction={handleSecondaryReviewAction} onVideoAction={handleVideoAction} onAppealAction={handleAppealAction} onLoadMoreSecondaryReviews={loadMoreSecondaryReviews} onLoadMoreVideos={loadMoreVideos} onLoadMoreAppeals={loadMoreAppeals} onFilterSecondaryReviews={(status) => loadSecondaryReviews({ status })} onSearchVideos={(query) => loadVideos({ search: query })} onFilterVideos={(status) => loadVideos({ status })} onSearchAppeals={(search) => loadAppeals({ search })} onVideoActivity={(video) => setActivityTarget({ entity: "VideoSubmission", entityId: video.id, title: video.photoId ?? `${video.user.nickname} 的视频` })} />;
    if (active === "users") return <UsersAdmin rows={data.users} pagination={data.usersPagination} onToggle={handleUserToggle} onUpdate={handleUserUpdate} onResetPassword={handleResetPassword} onLoadMore={loadMoreUsers} onSearch={(search) => loadUsers({ search })} onFilter={(guild) => loadUsers({ guild: guild === "all" ? "" : guild })} />;
    if (active === "points") return <PointsAdmin users={data.pointUsers} ledger={data.pointLedger} rule={data.pointRule} pagination={data.pointPagination} membersPagination={data.pointUsersPagination} onAdjust={handlePointAdjustment} onRuleSave={handlePointRuleSave} onLoadMore={loadMorePointLedger} onLoadMoreMembers={loadMorePointUsers} onSearchMembers={(search) => loadPointUsers({ search })} />;
    if (active === "gifts") return <GiftsAdmin rows={data.gifts} orders={data.orders} busyGiftId={giftActionId} onCreate={() => setGiftEditor({ gift: null })} onEdit={(gift) => setGiftEditor({ gift })} onMove={(gift, direction) => void handleGiftMove(gift, direction)} onTogglePin={(gift) => void handleGiftTogglePin(gift)} onDelete={(gift) => void handleGiftDelete(gift)} />;
    if (active === "orders") return <OrdersAdmin rows={data.orders} pagination={data.ordersPagination} onAction={handleOrderAction} onLoadMore={loadMoreOrders} onSearch={(search) => loadOrders({ search })} onFilter={(status) => loadOrders({ status: status === "ALL" ? "" : status === "PENDING" ? "PENDING_SHIPMENT" : status })} onActivity={(order) => setActivityTarget({ entity: "RedemptionOrder", entityId: order.id, title: `${order.gift.name}兑换订单` })} />;
    if (active === "rankings") return <RankingsAdmin periods={data.periods} onSettle={handleRankingSettle} onAwardUpdate={handleRankingAwardUpdate} />;
    if (active === "challenges") return <WeeklyChallengesAdmin periods={data.weeklyChallengePeriods} onRetry={handleWeeklyChallengeRetry} onUpgrade={handleWeeklyChallengeUpgrade} />;
    if (active === "announcements") return <AnnouncementsAdmin rows={data.announcements} users={data.announcementUsers} onSave={saveAnnouncement} onAction={actionAnnouncement} />;
    if (active === "logs") return <LogsAdmin rows={data.audit} pagination={data.auditPagination} onLoadMore={loadMoreAudit} onSearch={(search) => loadAudit({ search })} onFilter={(filters) => loadAudit(filters)} />;
    if (active === "settings") return <SettingsAdmin />;
    return <Overview data={data} />;
  };
  if (!data) {
    return <main className="admin-shell"><div className="admin-loading">{error ? <><strong>{error}</strong><button className="primary-button" onClick={() => window.location.reload()}>重新加载</button></> : "正在加载管理数据..."}</div></main>;
  }
  return (
    <main className="admin-shell">
      <AdminSidebar active={active} pendingVideos={data.metrics.pendingVideos} pendingOrders={data.metrics.pendingOrders} onChange={changeSection} onLogout={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); }} />
      <section className="admin-main">
        <header className="admin-topbar">
          <button className="mobile-admin-menu" aria-label="打开菜单" onClick={() => setMobileNavOpen(true)}><MoreHorizontal size={20} /></button>
          <div className="admin-breadcrumb"><span>管理后台</span><ChevronRight size={15} /><strong>{active === "workbench" ? "运营工作台" : active === "overview" ? "数据概览" : active === "videos" ? "视频与申诉" : active === "users" ? "用户与公会" : active === "points" ? "积分管理" : active === "gifts" ? "礼品管理" : active === "orders" ? "兑换订单" : active === "rankings" ? "榜单结算" : active === "challenges" ? "AI 周挑战" : active === "announcements" ? "公告通知" : active === "settings" ? "系统设置" : "审计日志"}</strong></div>
          <AdminGlobalSearch onNavigate={(section, filter) => changeSection(section as AdminSection, filter)} onActivity={(item) => setActivityTarget({ entity: ({ users: "User", videos: "VideoSubmission", orders: "RedemptionOrder", gifts: "Gift" } as Record<string, string>)[item.section] ?? "AuditLog", entityId: item.id, title: item.title })} />
          <div className="admin-top-actions"><span className="admin-divider" /><span className="admin-avatar">管</span><div className="admin-user"><strong>管理员</strong><small>超级管理员</small></div></div>
        </header>
        <div className="admin-content">
          {adminFeedback && (
            <div className={`admin-global-feedback ${adminFeedback.type}`} role={adminFeedback.type === "error" ? "alert" : "status"} aria-live="polite">
              {adminFeedback.type === "success" ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span>{adminFeedback.message}</span>
              <button className="icon-button" aria-label="关闭提示" onClick={() => setAdminFeedback(null)}><X size={16} /></button>
            </div>
          )}
          {render()}
        </div>
      </section>
      {giftEditor && <GiftEditorDialog gift={giftEditor.gift} onClose={() => setGiftEditor(null)} onSave={handleGiftSave} />}
      {activityTarget && <ActivityDrawer {...activityTarget} onClose={() => setActivityTarget(null)} />}
      <AdminMobileNav active={active} open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} onChange={changeSection} />
      {adminPromptDialog}
    </main>
  );
}

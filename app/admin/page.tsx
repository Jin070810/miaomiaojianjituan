"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  FileText,
  Gift,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MoreHorizontal,
  PackageCheck,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trophy,
  UserRound,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type AdminSection = "overview" | "videos" | "users" | "points" | "gifts" | "orders" | "rankings" | "announcements" | "logs";

type AdminVideo = {
  id: string;
  sourceUrl: string;
  likes: number | null;
  points: number;
  status: string;
  reviewReason: string | null;
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

type AdminGiftRow = { id: string; name: string; kind: "PHYSICAL" | "CASH"; pointsCost: number; stock: number; imageUrl: string | null; description: string | null; active: boolean };
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
  recipientName?: string | null;
  recipientPhone?: string | null;
  recipientAddress?: string | null;
  cashQrCodeUrl?: string | null;
  hasRecipientName?: boolean;
  hasRecipientPhone?: boolean;
  hasRecipientAddress?: boolean;
  hasCashQrCode?: boolean;
  gift: { name: string; kind: "PHYSICAL" | "CASH"; imageUrl: string | null };
  user: { kuaishouId: string; nickname: string };
};
type AdminAuditRow = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  createdAt: string;
  actor: { kuaishouId: string; nickname: string } | null;
};
type AdminRankingAward = {
  id: string;
  rank: number;
  value: number;
  status: string;
  giftId: string | null;
  gift: { id: string; name: string; kind: "PHYSICAL" | "CASH" } | null;
  user: { kuaishouId: string; nickname: string };
  recipientName: string | null;
  recipientPhone: string | null;
  recipientAddress: string | null;
};
type AdminRankingPeriod = {
  id: string;
  type: "WEEK" | "MONTH";
  periodStart: string;
  periodEnd: string;
  status: "OPEN" | "SETTLED";
  settledAt: string | null;
  awards: AdminRankingAward[];
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
type AdminData = {
  metrics: { users: number; pendingVideos: number; activeGifts: number; pendingOrders: number; totalBalance: number };
  pointsTrend: Array<{ label: string; videoReward: number; adminAdjustment: number }>;
  audit: AdminAuditRow[];
  videos: AdminVideo[];
  appeals: AdminAppeal[];
  users: AdminUserRow[];
  gifts: AdminGiftRow[];
  orders: AdminOrderRow[];
  periods: AdminRankingPeriod[];
  announcements: AdminAnnouncement[];
  pointLedger: AdminPointLedgerRow[];
  pointRule: VideoPointRule;
  pointPagination: AdminPagination;
  videosPagination: AdminPagination;
  appealsPagination: AdminPagination;
  usersPagination: AdminPagination;
  ordersPagination: AdminPagination;
  auditPagination: AdminPagination;
};

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

function videoStatusLabel(status: string) {
  return ({ APPROVED: "已到账", REJECTED: "已驳回", REVOKED: "已撤销", FAILED: "抓取失败", PROCESSING: "处理中", PENDING_REVIEW: "待审核" } as Record<string, string>)[status] ?? status;
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
        { id: "overview" as const, label: "数据概览", icon: LayoutDashboard },
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
        <button><Settings2 size={17} />系统设置</button>
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
        <StatCard label="待处理申诉" value={data.metrics.pendingVideos.toLocaleString()} trend="+ 待办" icon={ClipboardCheck} tone="yellow" />
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
            <div><span className="exception-icon danger"><AlertTriangle size={16} /></span><div><strong>视频申诉队列</strong><small>普通视频已自动通过或驳回</small></div><b>{data.metrics.pendingVideos}</b></div>
            <div><span className="exception-icon warning"><Activity size={16} /></span><div><strong>在架礼品</strong><small>库存与状态实时同步</small></div><b>{data.metrics.activeGifts}</b></div>
            <div><span className="exception-icon teal"><PackageCheck size={16} /></span><div><strong>待处理订单</strong><small>兑换积分已锁定</small></div><b>{data.metrics.pendingOrders}</b></div>
          </div>
          <button className="secondary-button full-button">查看全部待处理 <ChevronRight size={16} /></button>
        </section>
      </div>
      <section className="admin-panel audit-panel">
        <div className="admin-panel-head"><div><h2>最近视频记录</h2><p>实时查看自动入账和异常状态</p></div><button className="text-button">查看全部 <ChevronRight size={15} /></button></div>
        <AuditTable rows={data.videos} compact />
      </section>
    </>
  );
}

function AuditTable({ rows, compact = false, onAction }: { rows: AdminVideo[]; compact?: boolean; onAction?: (video: AdminVideo, action: "revoke" | "reprocess") => void }) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead><tr><th>视频与成员</th><th>点赞</th><th>奖励积分</th><th>状态</th><th>提交时间</th><th /></tr></thead>
        <tbody>
          {(compact ? rows.slice(0, 4) : rows).map((row) => (
            <tr key={row.id}>
              <td><div className="table-main"><span className="table-thumb">▶</span><div><strong>{row.sourceUrl}</strong><small>{row.user.nickname} · {row.user.kuaishouId}</small></div></div></td>
              <td>{row.likes?.toLocaleString() ?? "未获取"}</td><td className={row.status === "APPROVED" && row.points > 0 ? "positive-text" : ""}>{row.status === "APPROVED" && row.points > 0 ? `+${row.points.toLocaleString()}` : "未入账"}</td>
              <td><span className={`status-chip ${row.status === "APPROVED" ? "success" : row.status === "FAILED" ? "warning" : "danger"}`}>{videoStatusLabel(row.status)}</span></td><td>{formatAdminDate(row.submittedAt)}</td>
              <td>{onAction ? <div className="table-actions-inline">
                {row.status === "APPROVED" && <button className="table-more" title="撤销并扣回积分" aria-label="撤销视频积分" onClick={() => onAction(row, "revoke")}><X size={16} /></button>}
                {["REJECTED", "FAILED"].includes(row.status) && <button className="table-more" title="重新抓取并自动审核" aria-label="重新抓取" onClick={() => onAction(row, "reprocess")}><Activity size={16} /></button>}
              </div> : <button className="table-more" aria-label="更多操作"><MoreHorizontal size={17} /></button>}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6}>暂无待处理视频</td></tr>}
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
}: {
  rows: AdminVideo[];
  pagination: AdminPagination;
  onAction: (video: AdminVideo, action: "revoke" | "reprocess") => void;
  onLoadMore: () => Promise<void>;
  onSearch: (query: string) => Promise<void>;
  onFilter: (status: string) => Promise<void>;
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
        <div className="admin-panel-head"><div><h2>{filter}视频</h2><p>共 {pagination.total} 条记录，当前第 {pagination.page} / {pagination.pages} 页</p></div><div className="table-actions"><div className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitSearch(); }} placeholder="搜索视频、作者或快手 ID" /></div><button className="icon-button" title="执行搜索" aria-label="执行搜索" onClick={() => void submitSearch()}><Search size={18} /></button></div></div>
        <AuditTable rows={rows} onAction={onAction} />
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

function VideoManagement({
  videos,
  appeals,
  videosPagination,
  appealsPagination,
  onVideoAction,
  onAppealAction,
  onLoadMoreVideos,
  onLoadMoreAppeals,
  onSearchVideos,
  onFilterVideos,
  onSearchAppeals,
}: {
  videos: AdminVideo[];
  appeals: AdminAppeal[];
  videosPagination: AdminPagination;
  appealsPagination: AdminPagination;
  onVideoAction: (video: AdminVideo, action: "revoke" | "reprocess") => void;
  onAppealAction: (appeal: AdminAppeal, action: "approve" | "reject") => void;
  onLoadMoreVideos: () => Promise<void>;
  onLoadMoreAppeals: () => Promise<void>;
  onSearchVideos: (query: string) => Promise<void>;
  onFilterVideos: (status: string) => Promise<void>;
  onSearchAppeals: (query: string) => Promise<void>;
}) {
  const [view, setView] = useState<"appeals" | "history">("appeals");
  return (
    <>
      <div className="admin-page-title">
        <div><span className="eyebrow">CONTENT OPERATIONS</span><h1>视频与审核</h1><p>普通视频由系统自动通过或驳回，管理员只处理申诉；历史记录支持查询、撤销和重抓。</p></div>
        <span className={`status-chip ${appealsPagination.total ? "warning" : "success"}`}>{appealsPagination.total} 条待复查</span>
      </div>
      <div className="admin-tabs">
        <button className={view === "appeals" ? "active" : ""} onClick={() => setView("appeals")}>待处理申诉<span>{appealsPagination.total}</span></button>
        <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>视频历史<span>{videosPagination.total}</span></button>
      </div>
      {view === "appeals"
        ? <AppealsAdmin rows={appeals} pagination={appealsPagination} onAction={onAppealAction} onLoadMore={onLoadMoreAppeals} onSearch={onSearchAppeals} />
        : <VideosAdmin rows={videos} pagination={videosPagination} onAction={onVideoAction} onLoadMore={onLoadMoreVideos} onSearch={onSearchVideos} onFilter={onFilterVideos} />}
    </>
  );
}

function UsersAdmin({ rows, pagination, onToggle, onUpdate, onResetPassword, onLoadMore, onSearch, onFilter }: { rows: AdminUserRow[]; pagination: AdminPagination; onToggle: (user: AdminUserRow) => void; onUpdate: (user: AdminUserRow, input: { role?: "MEMBER" | "ADMIN"; guildStatus?: string }) => void; onResetPassword: (user: AdminUserRow) => void; onLoadMore: () => Promise<void>; onSearch: (query: string) => Promise<void>; onFilter: (filter: "all" | "joined" | "pending") => Promise<void> }) {
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
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>成员</th><th>角色</th><th>公会状态</th><th>当前积分</th><th>有效视频</th><th>注册时间</th><th /></tr></thead><tbody>{rows.map((user) => <tr key={user.id}><td><div className="table-main"><span className="table-avatar"><img src={user.avatarUrl || "/avatars/default.webp"} alt="" /></span><div><strong>{user.nickname}</strong><small>{user.kuaishouId}</small></div></div></td><td><select value={user.role} onChange={(event) => onUpdate(user, { role: event.target.value as "MEMBER" | "ADMIN" })} aria-label={`${user.nickname}角色`}><option value="MEMBER">普通成员</option><option value="ADMIN">管理员</option></select></td><td><select value={user.guildStatus ?? "未设置"} onChange={(event) => onUpdate(user, { guildStatus: event.target.value })} aria-label={`${user.nickname}公会状态`}><option>未设置</option><option>已邀请</option><option>已入会</option><option>已绑定</option><option>未绑定</option></select></td><td>{(user.account?.balance ?? 0).toLocaleString()}</td><td>{user._count.videos}</td><td>{formatAdminDate(user.createdAt)}</td><td><div className="table-actions-inline"><button className="table-more" title="重置密码" aria-label={`重置${user.nickname}密码`} onClick={() => onResetPassword(user)}><KeyRound size={15} /></button><button className="table-more" title={user.active ? "停用账号" : "启用账号"} aria-label={user.active ? "停用账号" : "启用账号"} onClick={() => onToggle(user)}>{user.active ? <X size={16} /> : <Check size={16} />}</button></div></td></tr>)}{rows.length === 0 && <tr><td colSpan={7}>没有匹配的成员</td></tr>}</tbody></table></div>
        {pagination.page < pagination.pages && <div className="admin-panel-actions"><button className="secondary-button" onClick={() => void onLoadMore()}>加载更多成员 <ChevronDown size={15} /></button></div>}
      </section>
    </>
  );
}

function PointsAdmin({
  users,
  ledger,
  rule,
  pagination,
  onAdjust,
  onRuleSave,
  onLoadMore,
}: {
  users: AdminUserRow[];
  ledger: AdminPointLedgerRow[];
  rule: VideoPointRule;
  pagination: { page: number; pages: number; total: number };
  onAdjust: (input: { userId: string; amount: number; reason: string }) => Promise<void>;
  onRuleSave: (input: VideoPointRule) => Promise<void>;
  onLoadMore: () => Promise<void>;
}) {
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [ruleDraft, setRuleDraft] = useState(rule);
  const [saving, setSaving] = useState(false);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  async function submitAdjustment() {
    const numericAmount = Number(amount);
    if (!userId || !Number.isInteger(numericAmount) || numericAmount === 0 || !reason.trim()) {
      setError("请选择成员，输入非零整数积分，并填写调整原因");
      return;
    }
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await onAdjust({ userId, amount: numericAmount, reason: reason.trim() });
      setAmount("");
      setReason("");
      setFeedback("积分调整已记录，余额和审计日志已更新。");
    } catch (adjustError) {
      setError(adjustError instanceof Error ? adjustError.message : "积分调整失败");
    } finally {
      setSaving(false);
    }
  }

  async function saveRule() {
    const values = Object.fromEntries(Object.entries(ruleDraft).map(([key, value]) => [key, Number(value)])) as VideoPointRule;
    if (Object.values(values).some((value) => !Number.isInteger(value) || value <= 0) || values.fixedTierMaxLikes < values.minimumLikes || values.maximumPoints < values.fixedTierPoints) {
      setError("积分规则必须全部为正整数，且档位和上限关系正确");
      return;
    }
    setRuleSaving(true);
    setError("");
    setFeedback("");
    try {
      await onRuleSave(values);
      setRuleDraft(values);
      setFeedback("积分规则已保存，仅对之后新抓取的视频生效。");
    } catch (ruleError) {
      setError(ruleError instanceof Error ? ruleError.message : "积分规则保存失败");
    } finally {
      setRuleSaving(false);
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div><span className="eyebrow">POINTS CONTROL</span><h1>积分管理</h1><p>所有人工调整必须说明原因，并在事务中生成不可变流水。</p></div>
      </div>
      {(error || feedback) && <p className={error ? "form-error" : "form-success"} role="status">{error || feedback}</p>}
      <div className="admin-dashboard-grid">
        <section className="admin-panel audit-panel">
          <div className="admin-panel-head"><div><h2>人工增减积分</h2><p>扣减不能超过成员当前余额；撤销类补偿由系统专用流程处理。</p></div><CircleDollarSign size={19} color="#149e91" /></div>
          <div className="admin-form-grid admin-panel-form">
            <div className="field"><label htmlFor="points-user">成员</label><select id="points-user" value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">选择成员</option>{users.filter((user) => user.active).map((user) => <option key={user.id} value={user.id}>{user.nickname} · {user.kuaishouId} · {(user.account?.balance ?? 0).toLocaleString()} 分</option>)}</select></div>
            <div className="field"><label htmlFor="points-amount">积分变动</label><input id="points-amount" type="number" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="正数发放，负数扣除" /></div>
          </div>
          <div className="field admin-panel-form"><label htmlFor="points-reason">原因</label><textarea id="points-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="例如：活动补发、人工纠错、违规扣分" /></div>
          <div className="admin-panel-actions"><button className="primary-button" disabled={saving} onClick={submitAdjustment}><CircleDollarSign size={16} />{saving ? "提交中..." : "提交积分调整"}</button></div>
        </section>
        <section className="admin-panel audit-panel">
          <div className="admin-panel-head"><div><h2>视频积分规则</h2><p>修改会留痕，不会重算历史视频。</p></div><SlidersHorizontal size={19} color="#ff5a3d" /></div>
          <div className="admin-form-grid admin-panel-form">
            <div className="field"><label htmlFor="rule-min-likes">最低点赞量</label><input id="rule-min-likes" type="number" step="1" value={ruleDraft.minimumLikes} onChange={(event) => setRuleDraft({ ...ruleDraft, minimumLikes: Number(event.target.value) })} /></div>
            <div className="field"><label htmlFor="rule-tier-max">固定档上限</label><input id="rule-tier-max" type="number" step="1" value={ruleDraft.fixedTierMaxLikes} onChange={(event) => setRuleDraft({ ...ruleDraft, fixedTierMaxLikes: Number(event.target.value) })} /></div>
            <div className="field"><label htmlFor="rule-tier-points">固定档积分</label><input id="rule-tier-points" type="number" step="1" value={ruleDraft.fixedTierPoints} onChange={(event) => setRuleDraft({ ...ruleDraft, fixedTierPoints: Number(event.target.value) })} /></div>
            <div className="field"><label htmlFor="rule-divisor">点赞除数</label><input id="rule-divisor" type="number" step="1" value={ruleDraft.likesDivisor} onChange={(event) => setRuleDraft({ ...ruleDraft, likesDivisor: Number(event.target.value) })} /></div>
            <div className="field"><label htmlFor="rule-max-points">最高积分</label><input id="rule-max-points" type="number" step="1" value={ruleDraft.maximumPoints} onChange={(event) => setRuleDraft({ ...ruleDraft, maximumPoints: Number(event.target.value) })} /></div>
            <div className="field"><label htmlFor="rule-window">有效天数</label><input id="rule-window" type="number" step="1" value={ruleDraft.submissionWindowDays} onChange={(event) => setRuleDraft({ ...ruleDraft, submissionWindowDays: Number(event.target.value) })} /></div>
          </div>
          <div className="admin-panel-actions"><button className="secondary-button" disabled={ruleSaving} onClick={saveRule}><Check size={16} />{ruleSaving ? "保存中..." : "保存规则"}</button></div>
        </section>
      </div>
      <section className="admin-panel audit-panel">
        <div className="admin-panel-head"><div><h2>积分流水</h2><p>共 {pagination.total} 条，当前显示第 {pagination.page} / {pagination.pages} 页</p></div></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>成员</th><th>类型</th><th>变动</th><th>变动后余额</th><th>说明</th><th>时间</th></tr></thead><tbody>{ledger.map((row) => <tr key={row.id}><td><div className="table-main"><span className="table-avatar">{row.account.user.nickname.slice(0, 1)}</span><div><strong>{row.account.user.nickname}</strong><small>{row.account.user.kuaishouId}</small></div></div></td><td>{row.type}</td><td className={row.amount >= 0 ? "positive-text" : "negative-text"}>{row.amount >= 0 ? "+" : ""}{row.amount.toLocaleString()}</td><td>{row.balanceAfter.toLocaleString()}</td><td>{row.note ?? "—"}</td><td>{formatAdminDate(row.createdAt)}</td></tr>)}{ledger.length === 0 && <tr><td colSpan={6}>暂无积分流水</td></tr>}</tbody></table></div>
        {pagination.page < pagination.pages && <div className="admin-panel-actions"><button className="secondary-button" onClick={onLoadMore}>加载更多流水 <ChevronDown size={15} /></button></div>}
      </section>
    </>
  );
}

function GiftEditorDialog({ gift, onClose, onSave }: { gift: AdminGiftRow | null; onClose: () => void; onSave: (input: { name: string; kind: "PHYSICAL" | "CASH"; pointsCost: number; stock: number; imageUrl?: string | null; description?: string | null; active: boolean }) => Promise<void> }) {
  const [name, setName] = useState(gift?.name ?? "");
  const [kind, setKind] = useState<"PHYSICAL" | "CASH">(gift?.kind ?? "PHYSICAL");
  const [pointsCost, setPointsCost] = useState(String(gift?.pointsCost ?? ""));
  const [stock, setStock] = useState(String(gift?.stock ?? ""));
  const [imageUrl, setImageUrl] = useState(gift?.imageUrl ?? "");
  const [description, setDescription] = useState(gift?.description ?? "");
  const [active, setActive] = useState(gift?.active ?? true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave({ name, kind, pointsCost: Number(pointsCost), stock: Number(stock), imageUrl: imageUrl || null, description: description || null, active });
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
        <div className="field"><label htmlFor="gift-kind">兑换类型</label><select id="gift-kind" value={kind} onChange={(event) => setKind(event.target.value as "PHYSICAL" | "CASH")}><option value="PHYSICAL">实物商品</option><option value="CASH">现金兑换</option></select></div>
        <div className="admin-form-grid"><div className="field"><label htmlFor="gift-points">积分价格</label><input id="gift-points" type="number" min="1" value={pointsCost} onChange={(event) => setPointsCost(event.target.value)} /></div><div className="field"><label htmlFor="gift-stock">库存</label><input id="gift-stock" type="number" min="0" value={stock} onChange={(event) => setStock(event.target.value)} /></div></div>
        <div className="field"><label htmlFor="gift-image">图片地址</label><input id="gift-image" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://..." /></div>
        <div className="field"><label htmlFor="gift-description">说明</label><textarea id="gift-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></div>
        <label className="checkbox-field"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> 上架到成员商城</label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-button" disabled={saving || !name || !pointsCost} onClick={save}>{saving ? "保存中..." : "保存礼品"}</button>
      </section>
    </div>
  );
}

function GiftsAdmin({ rows, orders, onCreate, onEdit }: { rows: AdminGiftRow[]; orders: AdminOrderRow[]; onCreate: () => void; onEdit: (gift: AdminGiftRow) => void }) {
  const stock = rows.reduce((total, gift) => total + gift.stock, 0);
  return (
    <>
      <div className="admin-page-title"><div><span className="eyebrow">REWARD CATALOG</span><h1>积分与礼品</h1><p>维护兑换规则、礼品库存和积分流水。</p></div><button className="primary-button" onClick={onCreate}><Gift size={16} />新增礼品</button></div>
      <div className="admin-stat-grid compact-stats"><StatCard label="上架礼品" value={rows.filter((gift) => gift.active).length.toString()} trend="+ 实时" icon={Gift} tone="coral" /><StatCard label="库存总量" value={stock.toLocaleString()} trend="+ 实时" icon={PackageCheck} tone="teal" /><StatCard label="累计兑换" value={orders.length.toString()} trend="+ 实时" icon={CircleDollarSign} tone="yellow" /></div>
      <section className="admin-panel audit-panel"><div className="admin-panel-head"><div><h2>礼品目录</h2><p>上架礼品将实时同步到成员商城</p></div><button className="text-button">编辑积分规则 <ChevronRight size={15} /></button></div><div className="gift-admin-grid">{rows.map((gift, i) => <div className="gift-admin-card" key={gift.id}><img src={gift.imageUrl && (gift.imageUrl.startsWith("http") || gift.imageUrl.startsWith("/")) ? gift.imageUrl : gifts[i % gifts.length].image} alt={gift.name} /><div><strong>{gift.name}</strong><span>{gift.kind === "CASH" ? "现金兑换" : "实物商品"} · {gift.pointsCost.toLocaleString()} 积分 · 库存 {gift.stock}</span></div><button className="table-more" title={gift.active ? "编辑礼品" : "礼品已下架"} onClick={() => onEdit(gift)}><MoreHorizontal size={17} /></button></div>)}</div></section>
    </>
  );
}

function OrderRecipientDetails({ order, onLoad }: { order: AdminOrderRow; onLoad: () => void }) {
  if (order.gift.kind === "CASH") {
    const safeQrCodeUrl = order.cashQrCodeUrl && /^(https?:\/\/|data:image\/)/i.test(order.cashQrCodeUrl)
      ? order.cashQrCodeUrl
      : null;
    return (
      <span className="order-recipient">
        收款信息：
        {safeQrCodeUrl
          ? <a href={safeQrCodeUrl} target="_blank" rel="noreferrer">查看收款码</a>
          : order.hasCashQrCode ? <button className="text-button" onClick={onLoad}>查看收款码</button> : "未填写收款码"}
      </span>
    );
  }

  if (!order.recipientName || !order.recipientPhone || !order.recipientAddress) {
    return <span className="order-recipient">收货信息：{order.hasRecipientPhone || order.hasRecipientAddress ? <button className="text-button" onClick={onLoad}>查看详情</button> : "尚未填写完整"}</span>;
  }

  return (
    <span className="order-recipient">
      收货信息：{order.recipientName} · {order.recipientPhone} · {order.recipientAddress}
    </span>
  );
}

function OrdersAdmin({ rows, pagination, onAction, onLoadMore, onSearch, onFilter }: { rows: AdminOrderRow[]; pagination: AdminPagination; onAction: (order: AdminOrderRow, action: "approve" | "fulfill" | "reject" | "refund") => void; onLoadMore: () => Promise<void>; onSearch: (query: string) => Promise<void>; onFilter: (status: "ALL" | "PENDING" | "FULFILLED") => Promise<void> }) {
  const [status, setStatus] = useState<"ALL" | "PENDING" | "FULFILLED">("ALL");
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState<Record<string, Pick<AdminOrderRow, "recipientName" | "recipientPhone" | "recipientAddress" | "cashQrCodeUrl">>>({});
  const loadDetails = async (order: AdminOrderRow) => {
    const response = await fetch(`/api/admin/orders/${order.id}`, { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json();
    setDetails((current) => ({ ...current, [order.id]: result.details }));
  };
  async function submitSearch() {
    await onSearch(query.trim());
  }
  function changeStatus(next: "ALL" | "PENDING" | "FULFILLED") {
    setStatus(next);
    void onFilter(next);
  }
  const filtered = rows;
  return (
    <>
      <div className="admin-page-title"><div><span className="eyebrow">FULFILLMENT CENTER</span><h1>兑换订单</h1><p>处理礼品发货和订单状态变更。</p></div><button className="secondary-button"><FileText size={16} />导出订单</button></div>
      <div className="order-status-row"><button className={status === "ALL" ? "active" : ""} onClick={() => changeStatus("ALL")}>全部订单 <b>{status === "ALL" ? pagination.total : rows.length}</b></button><button className={status === "PENDING" ? "active" : ""} onClick={() => changeStatus("PENDING")}>待发货 <b>{status === "PENDING" ? pagination.total : "—"}</b></button><button className={status === "FULFILLED" ? "active" : ""} onClick={() => changeStatus("FULFILLED")}>已完成 <b>{status === "FULFILLED" ? pagination.total : "—"}</b></button></div>
      <section className="admin-panel audit-panel"><div className="admin-panel-head"><div><h2>订单列表</h2><p>显示 {filtered.length} 条已加载订单，共 {pagination.total} 条；驳回订单会自动退回积分和库存</p></div><div className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitSearch(); }} placeholder="搜索订单号或快手 ID" /><button className="icon-button" title="执行搜索" aria-label="执行搜索" onClick={() => void submitSearch()}><Search size={18} /></button></div></div><div className="order-list">{filtered.map((order, i) => {
        const merged = { ...order, ...details[order.id] };
        const readyToFulfill = order.gift.kind === "CASH"
          ? Boolean(merged.cashQrCodeUrl || merged.hasCashQrCode)
          : Boolean(merged.recipientName && (merged.recipientPhone || merged.hasRecipientPhone) && (merged.recipientAddress || merged.hasRecipientAddress));
        const pendingShipment = ["PENDING", "APPROVED"].includes(order.status);
        return <div className="order-row" key={order.id}><span className="order-thumb"><img src={order.gift.imageUrl?.startsWith("http") || order.gift.imageUrl?.startsWith("/") ? order.gift.imageUrl : gifts[i % gifts.length].image} alt="" /></span><div><strong>{order.gift.name}</strong><span>{order.id} · {order.user.nickname} · {order.user.kuaishouId}</span><OrderRecipientDetails order={merged} onLoad={() => void loadDetails(order)} /></div><b>{order.totalCost.toLocaleString()} 分</b><span className={`status-chip ${pendingShipment ? "warning" : "success"}`}>{pendingShipment ? "待发货" : order.status === "FULFILLED" ? "已完成" : order.status}</span><div className="table-actions-inline">{pendingShipment && <button className="secondary-button mini-button" disabled={!readyToFulfill} title={readyToFulfill ? undefined : order.gift.kind === "CASH" ? "需先填写收款码" : "需先填写完整收货资料"} onClick={() => onAction(order, "fulfill")}>{order.gift.kind === "CASH" ? "完成" : "发货"}</button>}{pendingShipment && <button className="table-more" title="驳回并退回积分" aria-label="驳回订单" onClick={() => onAction(order, "reject")}><X size={16} /></button>}{order.status === "FULFILLED" && <button className="table-more" title="退款" aria-label="退款" onClick={() => onAction(order, "refund")}><X size={16} /></button>}</div></div>;
      })}{filtered.length === 0 && <p className="empty-copy">没有匹配的订单</p>}</div>{pagination.page < pagination.pages && <div className="admin-panel-actions"><button className="secondary-button" onClick={() => void onLoadMore()}>加载更多订单 <ChevronDown size={15} /></button></div>}</section>
    </>
  );
}

function RankingsAdmin({
  periods,
  onSettle,
  onAwardUpdate,
}: {
  periods: AdminRankingPeriod[];
  onSettle: (type: "week" | "month") => void;
  onAwardUpdate: (award: AdminRankingAward, input: { status?: "FULFILLED" }) => void;
}) {
  return (
    <>
      <div className="admin-page-title">
        <div><span className="eyebrow">RANKING SETTLEMENT</span><h1>榜单结算</h1><p>周榜按通过视频数，月榜按提交时点赞总量；每期前五名进入领奖流程。</p></div>
        <div className="table-actions-inline">
          <button className="secondary-button" onClick={() => onSettle("week")}><Trophy size={16} />检查周榜结算</button>
          <button className="secondary-button" onClick={() => onSettle("month")}><Trophy size={16} />检查月榜结算</button>
        </div>
      </div>
      {periods.map((period) => (
        <section className="admin-panel audit-panel" key={period.id}>
          <div className="admin-panel-head">
            <div><h2>{period.type === "WEEK" ? "周更新排行榜" : "月点赞量排行榜"}</h2><p>{new Date(period.periodStart).toLocaleDateString("zh-CN")} 至 {new Date(period.periodEnd).toLocaleDateString("zh-CN")} · {period.status === "SETTLED" ? "已结算" : "进行中"}</p></div>
            <span className={`status-chip ${period.status === "SETTLED" ? "success" : "warning"}`}>{period.status === "SETTLED" ? "已结算" : "进行中"}</span>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>名次与成员</th><th>成绩</th><th>奖励</th><th>领奖状态</th><th>收货信息</th><th /></tr></thead>
              <tbody>
                {period.awards.map((award) => (
                  <tr key={award.id}>
                    <td><div className="table-main"><span className="table-avatar">{award.rank}</span><div><strong>{award.user.nickname}</strong><small>{award.user.kuaishouId}</small></div></div></td>
                    <td>{award.value.toLocaleString()} {period.type === "WEEK" ? "个视频" : "赞"}</td>
                    <td>榜单奖励</td>
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

  const activeMembers = users.filter((user) => user.active && user.role === "MEMBER");
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

function LogsAdmin({ rows, pagination, onLoadMore, onSearch }: { rows: AdminAuditRow[]; pagination: AdminPagination; onLoadMore: () => Promise<void>; onSearch: (query: string) => Promise<void> }) {
  const [query, setQuery] = useState("");
  async function submitSearch() {
    await onSearch(query.trim());
  }
  return (
    <>
      <div className="admin-page-title"><div><span className="eyebrow">AUDIT TRAIL</span><h1>审计日志</h1><p>所有积分、身份和订单变更都在这里留痕。</p></div><button className="icon-button" title="只读日志" aria-label="只读日志"><SlidersHorizontal size={19} /></button></div>
      <section className="admin-panel audit-panel"><div className="admin-panel-head"><div><h2>系统操作记录</h2><p>只读记录 · 共 {pagination.total} 条，当前第 {pagination.page} / {pagination.pages} 页</p></div><div className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitSearch(); }} placeholder="搜索操作人或对象" /><button className="icon-button" title="执行搜索" aria-label="执行搜索" onClick={() => void submitSearch()}><Search size={18} /></button></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>操作</th><th>操作人</th><th>对象类型</th><th>对象 ID</th><th>时间</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><span className="log-action"><ShieldCheck size={15} />{row.action}</span></td><td>{row.actor?.nickname ?? "系统"}<small>{row.actor?.kuaishouId}</small></td><td>{row.entity}</td><td>{row.entityId ?? "—"}</td><td>{formatAdminDate(row.createdAt)}</td></tr>)}</tbody></table></div>{pagination.page < pagination.pages && <div className="admin-panel-actions"><button className="secondary-button" onClick={() => void onLoadMore()}>加载更多日志 <ChevronDown size={15} /></button></div>}</section>
    </>
  );
}

export default function AdminPage() {
  const [active, setActive] = useState<AdminSection>("overview");
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [giftEditor, setGiftEditor] = useState<{ gift: AdminGiftRow | null } | null>(null);
  const [videoFilters, setVideoFilters] = useState({ search: "", status: "" });
  const [appealSearch, setAppealSearch] = useState("");
  const [userFilters, setUserFilters] = useState({ search: "", guild: "" });
  const [orderFilters, setOrderFilters] = useState({ search: "", status: "" });
  const [auditSearch, setAuditSearch] = useState("");
  const router = useRouter();
  useEffect(() => {
    let activeRequest = true;
    Promise.all([
      fetch("/api/admin/dashboard", { cache: "no-store" }),
      fetch("/api/admin/videos", { cache: "no-store" }),
      fetch("/api/admin/video-appeals", { cache: "no-store" }),
      fetch("/api/admin/users?take=200", { cache: "no-store" }),
      fetch("/api/admin/gifts", { cache: "no-store" }),
      fetch("/api/admin/orders", { cache: "no-store" }),
      fetch("/api/admin/audit-logs?take=50", { cache: "no-store" }),
      fetch("/api/admin/rankings", { cache: "no-store" }),
      fetch("/api/admin/announcements?take=50", { cache: "no-store" }),
      fetch("/api/admin/points?take=50", { cache: "no-store" }),
      fetch("/api/admin/point-rules", { cache: "no-store" }),
    ]).then(async ([dashboardResponse, videosResponse, appealsResponse, usersResponse, giftsResponse, ordersResponse, auditResponse, rankingsResponse, announcementsResponse, pointsResponse, pointRulesResponse]) => {
      if ([dashboardResponse, videosResponse, appealsResponse, usersResponse, giftsResponse, ordersResponse, auditResponse, rankingsResponse, announcementsResponse, pointsResponse, pointRulesResponse].some((response) => response.status === 401 || response.status === 403)) {
        router.replace("/login");
        return;
      }
      const [dashboard, videos, appeals, users, gifts, orders, audit, rankings, announcements, points, pointRules] = await Promise.all([
        dashboardResponse.json(), videosResponse.json(), appealsResponse.json(), usersResponse.json(), giftsResponse.json(), ordersResponse.json(), auditResponse.json(), rankingsResponse.json(), announcementsResponse.json(), pointsResponse.json(), pointRulesResponse.json(),
      ]);
      if (!dashboardResponse.ok) throw new Error(dashboard.error ?? "后台数据加载失败");
      if (activeRequest) {
        setData({
          ...dashboard,
          videos: videos.videos ?? [],
          videosPagination: videos.pagination ?? { page: 1, take: 50, total: 0, pages: 1 },
          appeals: appeals.appeals ?? [],
          appealsPagination: appeals.pagination ?? { page: 1, take: 50, total: 0, pages: 1 },
          users: users.users ?? [],
          usersPagination: users.pagination ?? { page: 1, take: 200, total: 0, pages: 1 },
          gifts: gifts.gifts ?? [],
          orders: orders.orders ?? [],
          ordersPagination: orders.pagination ?? { page: 1, take: 50, total: 0, pages: 1 },
          audit: audit.audit ?? dashboard.audit ?? [],
          pointsTrend: dashboard.pointsTrend ?? [],
          auditPagination: audit.pagination ?? { page: 1, take: 50, total: (audit.audit ?? dashboard.audit ?? []).length, pages: 1 },
          periods: rankings.periods ?? [],
          announcements: announcements.announcements ?? [],
          pointLedger: points.ledger ?? [],
          pointPagination: points.pagination ?? { page: 1, take: 50, total: 0, pages: 1 },
          pointRule: pointRules.rule,
        });
      }
    }).catch((loadError) => {
      if (activeRequest) setError(loadError instanceof Error ? loadError.message : "后台数据加载失败");
    });
    return () => { activeRequest = false; };
  }, [router]);
  async function fetchAdminPage(path: string, fallbackMessage: string) {
    const response = await fetch(path, { cache: "no-store" });
    const result = await response.json();
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
      window.alert(loadError instanceof Error ? loadError.message : "视频记录加载失败");
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
      window.alert(loadError instanceof Error ? loadError.message : "申诉记录加载失败");
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
      window.alert(loadError instanceof Error ? loadError.message : "成员记录加载失败");
    }
  }
  async function loadMoreUsers() {
    if (!data || data.usersPagination.page >= data.usersPagination.pages) return;
    await loadUsers({ page: data.usersPagination.page + 1, append: true });
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
      window.alert(loadError instanceof Error ? loadError.message : "订单记录加载失败");
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
  async function loadAudit(input: { page?: number; search?: string; append?: boolean }) {
    if (!data) return;
    const search = input.search ?? auditSearch;
    const page = input.page ?? 1;
    const params = new URLSearchParams({ page: String(page), take: String(data.auditPagination.take) });
    if (search) params.set("search", search);
    try {
      const result = await fetchAdminPage(`/api/admin/audit-logs?${params}`, "审计日志加载失败");
      setAuditSearch(search);
      setData((current) => current ? {
        ...current,
        audit: input.append ? [...current.audit, ...(result.audit ?? [])] : (result.audit ?? []),
        auditPagination: result.pagination,
      } : current);
    } catch (loadError) {
      window.alert(loadError instanceof Error ? loadError.message : "审计日志加载失败");
    }
  }
  async function handleVideoAction(video: AdminVideo, action: "revoke" | "reprocess") {
    const reason = action === "revoke" ? window.prompt("请输入撤销原因") : undefined;
    if (action === "revoke" && !reason) return;
    const response = await fetch(`/api/videos/${video.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, reason, points: video.points }),
    });
    const result = await response.json();
    if (!response.ok) {
      window.alert(result.error ?? "操作失败");
      return;
    }
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
  }
  async function handleAppealAction(appeal: AdminAppeal, action: "approve" | "reject") {
    const reason = action === "reject" ? window.prompt("请输入驳回申诉原因") : window.prompt("可选：填写复查说明或留空使用默认积分");
    if (action === "reject" && !reason) return;
    let points: number | undefined;
    if (action === "approve") {
      const raw = window.prompt(`请输入核定积分（当前抓取点赞 ${appeal.video.likes ?? 0}，建议 ${appeal.video.points || "自动计算"}）`, String(appeal.video.points || ""));
      if (raw !== null && raw.trim() !== "") {
        points = Number(raw);
        if (!Number.isInteger(points) || points < 0) { window.alert("积分必须是非负整数"); return; }
      }
    }
    const response = await fetch(`/api/admin/video-appeals/${appeal.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, reason, points }),
    });
    const result = await response.json();
    if (!response.ok) { window.alert(result.error ?? "申诉处理失败"); return; }
    setData((current) => current ? {
      ...current,
      appeals: current.appeals.filter((item) => item.id !== appeal.id),
      appealsPagination: { ...current.appealsPagination, total: Math.max(0, current.appealsPagination.total - 1) },
      metrics: { ...current.metrics, pendingVideos: Math.max(0, current.metrics.pendingVideos - 1) },
    } : current);
  }
  async function handleOrderAction(order: AdminOrderRow, action: "approve" | "fulfill" | "reject" | "refund") {
    const reason = ["reject", "refund"].includes(action) ? window.prompt("请输入处理原因") : undefined;
    if (["reject", "refund"].includes(action) && !reason) return;
    const response = await fetch(`/api/admin/orders/${order.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    const result = await response.json();
    if (!response.ok) {
      window.alert(result.error ?? "订单操作失败");
      return;
    }
    setData((current) => current ? {
      ...current,
      orders: current.orders.map((item) => item.id === order.id ? { ...item, status: result.order.status } : item),
      metrics: { ...current.metrics, pendingOrders: ["approve", "fulfill", "reject", "refund"].includes(action) && ["PENDING", "APPROVED"].includes(order.status) ? Math.max(0, current.metrics.pendingOrders - 1) : current.metrics.pendingOrders },
    } : current);
  }
  async function handleUserUpdate(user: AdminUserRow, input: { active?: boolean; role?: "MEMBER" | "ADMIN"; guildStatus?: string }) {
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok) {
      window.alert(result.error ?? "更新失败");
      return;
    }
    setData((current) =>
      current
        ? {
            ...current,
            users: current.users.map((item) =>
              item.id === user.id ? { ...item, active: result.user.active, role: result.user.role, guildStatus: result.user.guildStatus } : item,
            ),
          }
        : current,
    );
  }
  async function handleUserToggle(user: AdminUserRow) {
    await handleUserUpdate(user, { active: !user.active });
  }
  async function handleResetPassword(user: AdminUserRow) {
    const password = window.prompt(`为 ${user.nickname} 设置临时密码（至少 8 位）`);
    if (!password) return;
    const response = await fetch(`/api/admin/users/${user.id}/password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json();
    if (!response.ok) {
      window.alert(result.error ?? "密码重置失败");
      return;
    }
    window.alert("密码已重置，旧登录会话已失效。请通过安全方式将临时密码交给成员。");
  }
  async function handleRankingSettle(type: "week" | "month") {
    const response = await fetch("/api/admin/rankings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "settle", type }),
    });
    const result = await response.json();
    if (!response.ok) {
      window.alert(result.error ?? "榜单结算失败");
      return;
    }
    const refreshed = await fetch("/api/admin/rankings", { cache: "no-store" });
    const rankings = await refreshed.json();
    setData((current) => current ? { ...current, periods: rankings.periods ?? [] } : current);
    if (!result.settled) window.alert(result.reason ?? "该周期尚未结束");
  }
  async function handleRankingAwardUpdate(award: AdminRankingAward, input: { status?: "FULFILLED" }) {
    const response = await fetch(`/api/admin/rankings/awards/${award.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok) {
      window.alert(result.error ?? "奖励更新失败");
      return;
    }
    const refreshed = await fetch("/api/admin/rankings", { cache: "no-store" });
    const rankings = await refreshed.json();
    setData((current) => current ? { ...current, periods: rankings.periods ?? [] } : current);
  }
  async function handlePointAdjustment(input: { userId: string; amount: number; reason: string }) {
    const response = await fetch("/api/admin/points", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "积分调整失败");
    setData((current) => {
      if (!current) return current;
      return {
        ...current,
        metrics: { ...current.metrics, totalBalance: current.metrics.totalBalance + input.amount },
        users: current.users.map((user) => user.id === input.userId ? { ...user, account: { balance: result.balance } } : user),
        pointLedger: [result.ledger, ...current.pointLedger.filter((row: AdminPointLedgerRow) => row.id !== result.ledger.id)],
        pointPagination: { ...current.pointPagination, total: current.pointPagination.total + 1 },
      };
    });
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
  async function handleGiftSave(input: { name: string; kind: "PHYSICAL" | "CASH"; pointsCost: number; stock: number; imageUrl?: string | null; description?: string | null; active: boolean }) {
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
      gifts: gift ? current.gifts.map((item) => item.id === gift.id ? result.gift : item) : [result.gift, ...current.gifts],
    } : current);
  }
  const render = () => {
    if (!data) return null;
    if (active === "videos") return <VideoManagement videos={data.videos} appeals={data.appeals} videosPagination={data.videosPagination} appealsPagination={data.appealsPagination} onVideoAction={handleVideoAction} onAppealAction={handleAppealAction} onLoadMoreVideos={loadMoreVideos} onLoadMoreAppeals={loadMoreAppeals} onSearchVideos={(query) => loadVideos({ search: query })} onFilterVideos={(status) => loadVideos({ status })} onSearchAppeals={(search) => loadAppeals({ search })} />;
    if (active === "users") return <UsersAdmin rows={data.users} pagination={data.usersPagination} onToggle={handleUserToggle} onUpdate={handleUserUpdate} onResetPassword={handleResetPassword} onLoadMore={loadMoreUsers} onSearch={(search) => loadUsers({ search })} onFilter={(guild) => loadUsers({ guild: guild === "all" ? "" : guild })} />;
    if (active === "points") return <PointsAdmin users={data.users} ledger={data.pointLedger} rule={data.pointRule} pagination={data.pointPagination} onAdjust={handlePointAdjustment} onRuleSave={handlePointRuleSave} onLoadMore={loadMorePointLedger} />;
    if (active === "gifts") return <GiftsAdmin rows={data.gifts} orders={data.orders} onCreate={() => setGiftEditor({ gift: null })} onEdit={(gift) => setGiftEditor({ gift })} />;
    if (active === "orders") return <OrdersAdmin rows={data.orders} pagination={data.ordersPagination} onAction={handleOrderAction} onLoadMore={loadMoreOrders} onSearch={(search) => loadOrders({ search })} onFilter={(status) => loadOrders({ status: status === "ALL" ? "" : status === "PENDING" ? "PENDING_SHIPMENT" : status })} />;
    if (active === "rankings") return <RankingsAdmin periods={data.periods} onSettle={handleRankingSettle} onAwardUpdate={handleRankingAwardUpdate} />;
    if (active === "announcements") return <AnnouncementsAdmin rows={data.announcements} users={data.users} onSave={saveAnnouncement} onAction={actionAnnouncement} />;
    if (active === "logs") return <LogsAdmin rows={data.audit} pagination={data.auditPagination} onLoadMore={loadMoreAudit} onSearch={(search) => loadAudit({ search })} />;
    return <Overview data={data} />;
  };
  if (!data) {
    return <main className="admin-shell"><div className="admin-loading">{error ? <><strong>{error}</strong><button className="primary-button" onClick={() => window.location.reload()}>重新加载</button></> : "正在加载管理数据..."}</div></main>;
  }
  return (
    <main className="admin-shell">
      <AdminSidebar active={active} pendingVideos={data.metrics.pendingVideos} pendingOrders={data.metrics.pendingOrders} onChange={setActive} onLogout={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); }} />
      <section className="admin-main">
        <header className="admin-topbar">
          <button className="mobile-admin-menu" aria-label="打开菜单"><MoreHorizontal size={20} /></button>
          <div className="admin-breadcrumb"><span>管理后台</span><ChevronRight size={15} /><strong>{active === "overview" ? "数据概览" : active === "videos" ? "视频与申诉" : active === "users" ? "用户与公会" : active === "points" ? "积分管理" : active === "gifts" ? "礼品管理" : active === "orders" ? "兑换订单" : active === "rankings" ? "榜单结算" : active === "announcements" ? "公告通知" : "审计日志"}</strong></div>
          <div className="admin-top-actions"><button className="icon-button"><Bell size={18} /></button><span className="admin-divider" /><span className="admin-avatar">管</span><div className="admin-user"><strong>管理员</strong><small>超级管理员</small></div></div>
        </header>
        <div className="admin-content">{render()}</div>
      </section>
      {giftEditor && <GiftEditorDialog gift={giftEditor.gift} onClose={() => setGiftEditor(null)} onSave={handleGiftSave} />}
    </main>
  );
}

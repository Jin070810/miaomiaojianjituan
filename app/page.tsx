"use client";

import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  ClipboardPaste,
  Coins,
  Copy,
  KeyRound,
  Gift,
  Home,
  Link2,
  LogOut,
  Medal,
  Minus,
  MoreHorizontal,
  PackageCheck,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import NotificationCenter, { clearNotificationPromptSession } from "./components/NotificationCenter";

type MemberView = "home" | "videos" | "mall" | "rank" | "profile" | "ledger" | "transfers" | "orders";

type DialogType = "submit" | "transfer" | "redeem" | "profile" | "recipient" | "password" | null;

type DashboardData = {
  user: {
    id: string;
    kuaishouId: string;
    nickname: string;
    avatarUrl: string | null;
    role: "MEMBER" | "ADMIN";
    guildStatus: string | null;
    invited: boolean;
    balance: number;
  };
  summary: {
    monthlyIncome: number;
    approvedVideos: number;
    monthlyApprovedVideos: number;
    videoPoints: number;
    totalLikes: number;
    averageLikes: number;
    rank: number | null;
    videoCounts: { all: number; approved: number; processing: number; exception: number };
  };
  ledger: Array<{
    id: string;
    type: string;
    amount: number;
    note: string | null;
    createdAt: string;
  }>;
  videos: Array<{
    id: string;
    sourceUrl: string;
    status: string;
    likes: number | null;
    points: number;
    submittedAt: string;
    reviewReason: string | null;
    appeals: Array<{
      id: string;
      reason: string;
      status: "PENDING" | "APPROVED" | "REJECTED";
      reviewReason: string | null;
      reviewedPoints: number | null;
      createdAt: string;
    }>;
  }>;
  gifts: Array<{
    id: string;
    name: string;
    kind: "PHYSICAL" | "CASH";
    pointsCost: number;
    stock: number;
    imageUrl: string | null;
    description: string | null;
  }>;
  orders: Array<{ id: string; status: string; totalCost: number; createdAt: string; fulfilledAt: string | null; trackingNumber: string | null; gift: { name: string; kind: "PHYSICAL" | "CASH"; imageUrl: string | null } }>;
  transfers: Array<{
    id: string;
    amount: number;
    senderId: string;
    receiverId: string;
    createdAt: string;
    note: string | null;
    sender: { kuaishouId: string; nickname: string };
    receiver: { kuaishouId: string; nickname: string };
  }>;
  leaderboard: Array<{ rank: number; userId: string; kuaishouId: string; nickname: string; avatarUrl: string | null; points: number; current: boolean }>;
};

type WeeklyChallengeData = {
  id: string;
  type: "VIDEO_COUNT" | "LIKE_SUM" | "COMBINED";
  status: "ACTIVE" | "COMPLETED" | "CLAIMED" | "REVERSED" | "EXPIRED";
  title: string;
  description: string;
  aiReason: string;
  baselineVideoCount: number;
  baselineLikes: number;
  targetVideoCount: number | null;
  targetLikes: number | null;
  rewardPoints: number;
  completedAt: string | null;
  claimedAt: string | null;
  reversedAt: string | null;
  progress: { videoCount: number; likes: number; qualified: boolean };
  rewardsEnabled: boolean;
  claimable: boolean;
  raceEnded: boolean;
  period: {
    periodStart: string;
    periodEnd: string;
    claimEndsAt: string;
    raceReward: number;
  };
};

type DisplayGift = {
  id: string;
  name: string;
  points: number;
  stock: number;
  image: string;
  tag: string;
  tone: string;
  kind: "PHYSICAL" | "CASH";
};

type MemberAward = {
  id: string;
  rank: number;
  value: number;
  status: "PENDING" | "CLAIMED" | "FULFILLED" | "EXPIRED";
  gift: { id: string; name: string; kind: "PHYSICAL" | "CASH"; imageUrl: string | null } | null;
  period: { type: "WEEK" | "MONTH"; periodStart: string; periodEnd: string };
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatTodayLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    weekday: "short",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date()).replace(/\s/g, "");
}

function LoadMoreHistory({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <button className="secondary-button full-button" onClick={onClick} disabled={loading}>
      <ChevronDown size={16} /> {loading ? "加载中..." : "加载更多记录"}
    </button>
  );
}

function ledgerLabel(type: string, note: string | null) {
  if (note) return note;
  const labels: Record<string, string> = {
    VIDEO_REWARD: "视频奖励",
    TRANSFER_IN: "转账收入",
    TRANSFER_OUT: "积分转出",
    REDEMPTION: "礼品兑换",
    ADMIN_ADJUSTMENT: "管理员调整",
    REVERSAL: "积分冲正",
  };
  return labels[type] ?? "积分变动";
}

const gifts: DisplayGift[] = [
  {
    id: "g1",
    name: "剪辑团定制保温杯",
    points: 680,
    stock: 38,
    image:
      "https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=900&q=85",
    tag: "人气礼品",
    tone: "orange",
    kind: "PHYSICAL" as const,
  },
  {
    id: "g2",
    name: "创作者桌面收纳套装",
    points: 420,
    stock: 12,
    image:
      "https://images.unsplash.com/photo-1586953208448-b95a79798f07?auto=format&fit=crop&w=900&q=85",
    tag: "限量",
    tone: "teal",
    kind: "PHYSICAL" as const,
  },
  {
    id: "g3",
    name: "视频剪辑会员月卡",
    points: 260,
    stock: 86,
    image:
      "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=900&q=85",
    tag: "实用兑换",
    tone: "purple",
    kind: "PHYSICAL" as const,
  },
  {
    id: "g4",
    name: "创作灵感便签礼盒",
    points: 180,
    stock: 64,
    image:
      "https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=900&q=85",
    tag: "新品",
    tone: "green",
    kind: "PHYSICAL" as const,
  },
];

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup ${compact ? "compact" : ""}`}>
      <span className="brand-mark">妙</span>
      <span className="brand-name">
        <strong>妙妙剪辑团</strong>
        {!compact && <small>积分中心</small>}
      </span>
    </div>
  );
}

function Avatar({ text = "妙", tone = "coral", imageUrl }: { text?: string; tone?: string; imageUrl?: string | null }) {
  return <span className={`avatar avatar-${tone}`}><img src={imageUrl || "/avatars/default.webp"} alt={`${text}的头像`} /></span>;
}

function ModalShell({
  title,
  eyebrow,
  children,
  onClose,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2 id="modal-title">{title}</h2>
          </div>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function BottomNav({
  active,
  onChange,
}: {
  active: MemberView;
  onChange: (view: MemberView) => void;
}) {
  const items = [
    { id: "home" as const, label: "首页", icon: Home },
    { id: "videos" as const, label: "视频", icon: ClipboardCheck },
    { id: "mall" as const, label: "商城", icon: Gift },
    { id: "rank" as const, label: "排行", icon: Trophy },
    { id: "profile" as const, label: "我的", icon: UserRound },
  ];
  return (
    <nav className="bottom-nav" aria-label="成员导航">
      {items.map((item) => {
        const Icon = item.icon;
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            className={selected ? "nav-item active" : "nav-item"}
            onClick={() => onChange(item.id)}
          >
            <Icon size={20} strokeWidth={selected ? 2.5 : 1.9} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function HomeView({
  onNavigate,
  onOpen,
  challenge,
  onClaimChallenge,
  data,
}: {
  onNavigate: (view: MemberView) => void;
  onOpen: (dialog: DialogType) => void;
  challenge: WeeklyChallengeData | null;
  onClaimChallenge: () => Promise<void>;
  data: DashboardData;
}) {
  const recentLedger = data.ledger.slice(0, 3);
  const [claimingChallenge, setClaimingChallenge] = useState(false);
  const [challengeError, setChallengeError] = useState("");
  async function claimChallenge() {
    setClaimingChallenge(true);
    setChallengeError("");
    try {
      await onClaimChallenge();
    } catch (error) {
      setChallengeError(error instanceof Error ? error.message : "任务奖励领取失败");
    } finally {
      setClaimingChallenge(false);
    }
  }
  return (
    <div className="member-content">
      <section className="welcome-row">
        <div>
          <span className="eyebrow">{formatTodayLabel()}</span>
          <h1>你好，{data.user.nickname}</h1>
          <p>今天也来攒一点创作能量吧。</p>
        </div>
        <span className="notification-heading-spacer" aria-hidden="true" />
      </section>

      <section className="balance-card">
        <div className="balance-topline">
          <span>当前可用积分</span>
          <button className="balance-more" aria-label="更多积分信息">
            <MoreHorizontal size={20} />
          </button>
        </div>
        <div className="balance-value">
          <strong>{data.user.balance.toLocaleString()}</strong>
          <span>分</span>
        </div>
        <div className="balance-foot">
          <span>本月已获得 <b>{data.summary.monthlyIncome.toLocaleString()}</b> 分</span>
          <span className="balance-trend"><ArrowUpRight size={14} /> 实时</span>
        </div>
      </section>

      {challenge && (
        <section className="weekly-challenge" aria-labelledby="weekly-challenge-title">
          <div className="weekly-challenge-head">
            <span className="weekly-challenge-icon"><Sparkles size={19} /></span>
            <div>
              <span className="eyebrow">本周 AI 挑战</span>
              <h2 id="weekly-challenge-title">{challenge.title}</h2>
            </div>
            <span className={`status-chip ${challenge.status === "CLAIMED" ? "success" : challenge.status === "REVERSED" || challenge.status === "EXPIRED" ? "danger" : "warning"}`}>
              {challenge.status === "CLAIMED" ? "已领取" : challenge.status === "REVERSED" ? "已撤销" : challenge.status === "EXPIRED" ? "已结束" : challenge.progress.qualified ? "已达标" : "进行中"}
            </span>
          </div>
          <p className="weekly-challenge-description">{challenge.description}</p>
          <div className="weekly-challenge-progress">
            {challenge.targetVideoCount !== null && (
              <div>
                <span><b>通过视频</b><strong>{challenge.progress.videoCount} / {challenge.targetVideoCount}</strong></span>
                <progress max={challenge.targetVideoCount} value={Math.min(challenge.progress.videoCount, challenge.targetVideoCount)} />
              </div>
            )}
            {challenge.targetLikes !== null && (
              <div>
                <span><b>累计点赞</b><strong>{challenge.progress.likes.toLocaleString()} / {challenge.targetLikes.toLocaleString()}</strong></span>
                <progress max={challenge.targetLikes} value={Math.min(challenge.progress.likes, challenge.targetLikes)} />
              </div>
            )}
          </div>
          <div className="weekly-challenge-baseline">
            <Target size={16} />
            <span>个人基线：每周 {challenge.baselineVideoCount} 条通过视频、{challenge.baselineLikes.toLocaleString()} 点赞</span>
          </div>
          <p className="weekly-challenge-reason">{challenge.aiReason}</p>
          <div className="weekly-challenge-foot">
            <div>
              <span>达标奖励</span>
              <strong>{challenge.rewardPoints.toLocaleString()} 分</strong>
              <small>{challenge.raceEnded ? "本周竞速已结束" : `最先达标另得 ${challenge.period.raceReward.toLocaleString()} 分`}</small>
            </div>
            {challenge.progress.qualified && ["ACTIVE", "COMPLETED"].includes(challenge.status) && (
              <button className="primary-button compact-button" disabled={!challenge.rewardsEnabled || claimingChallenge} onClick={() => void claimChallenge()}>
                {!challenge.rewardsEnabled ? "发放暂停" : claimingChallenge ? "领取中..." : "领取奖励"}
              </button>
            )}
          </div>
          {challengeError && <p className="form-error" role="alert">{challengeError}</p>}
        </section>
      )}

      <section className="quick-actions">
        <button onClick={() => onOpen("submit")}>
          <span className="quick-icon coral">
            <Plus size={19} />
          </span>
          <span>提交视频</span>
        </button>
        <button onClick={() => onOpen("transfer")}>
          <span className="quick-icon teal">
            <Send size={18} />
          </span>
          <span>积分转账</span>
        </button>
        <button onClick={() => onNavigate("mall")}>
          <span className="quick-icon yellow">
            <Gift size={18} />
          </span>
          <span>兑换礼品</span>
        </button>
        <button onClick={() => onNavigate("ledger")}>
          <span className="quick-icon purple">
            <WalletCards size={18} />
          </span>
          <span>积分明细</span>
        </button>
      </section>

      <section className="guild-status">
        <div className="guild-icon">
          <ShieldCheck size={22} />
        </div>
        <div className="guild-copy">
          <div className="guild-title">
            <strong>公会邀请</strong>
            <span className="status-chip teal">{data.user.guildStatus ?? "未设置"}</span>
          </div>
          <p>{data.user.invited ? "妙妙剪辑团 · 邀请已发送" : "妙妙剪辑团 · 当前公会状态已同步"}</p>
        </div>
        <ChevronRight size={18} className="muted-icon" />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2 className="section-title">最近动态</h2>
          <button className="section-action" onClick={() => onNavigate("ledger")}>
            查看全部
          </button>
        </div>
        <div className="activity-list">
          {recentLedger.map((item) => {
            const Icon = item.amount >= 0 ? ArrowDownLeft : Gift;
            return (
              <div className="activity-item" key={item.id}>
                <span className={`activity-icon ${item.amount >= 0 ? "positive" : "negative"}`}>
                  <Icon size={17} />
                </span>
                <div className="activity-copy">
                  <strong>{ledgerLabel(item.type, item.note)}</strong>
                  <span>{formatDate(item.createdAt)}</span>
                </div>
                <b className={item.amount >= 0 ? "positive-text" : "negative-text"}>
                  {item.amount >= 0 ? "+" : ""}{item.amount.toLocaleString()}
                </b>
              </div>
            );
          })}
          {recentLedger.length === 0 && <p className="empty-copy">暂时没有积分动态</p>}
        </div>
      </section>

      <section className="mini-rank-card">
        <div>
          <span className="eyebrow">总积分榜</span>
          <h2>{data.summary.rank ? `你当前第 ${data.summary.rank} 名` : "榜单正在统计"}</h2>
          <p>按当前可用积分实时更新排名</p>
        </div>
        <div className="mini-rank-medal">
          <Medal size={28} />
          <strong>{data.summary.rank ?? "–"}</strong>
        </div>
      </section>
    </div>
  );
}

function VideosView({
  onOpen,
  data,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  onOpen: (dialog: DialogType) => void;
  data: DashboardData;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const [appealingVideo, setAppealingVideo] = useState<DashboardData["videos"][number] | null>(null);
  const [filter, setFilter] = useState<"ALL" | "APPROVED" | "PROCESSING" | "EXCEPTION">("ALL");
  const [appealReason, setAppealReason] = useState("");
  const [appealError, setAppealError] = useState("");
  const [appealSaving, setAppealSaving] = useState(false);
  const [submittedAppeals, setSubmittedAppeals] = useState<Record<string, boolean>>({});
  async function submitAppeal() {
    if (!appealingVideo) return;
    setAppealSaving(true);
    setAppealError("");
    try {
      const response = await fetch(`/api/videos/${appealingVideo.id}/appeal`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ reason: appealReason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "申诉提交失败");
      setSubmittedAppeals((current) => ({ ...current, [appealingVideo.id]: true }));
      setAppealingVideo(null);
      setAppealReason("");
    } catch (appealSubmitError) {
      setAppealError(appealSubmitError instanceof Error ? appealSubmitError.message : "申诉提交失败");
    } finally {
      setAppealSaving(false);
    }
  }
  const filteredVideos = data.videos.filter((video) => {
    if (filter === "ALL") return true;
    if (filter === "APPROVED") return video.status === "APPROVED";
    if (filter === "PROCESSING") return video.status === "PROCESSING";
    return ["REJECTED", "FAILED", "PENDING_REVIEW", "REVOKED"].includes(video.status);
  });
  const rows = filteredVideos.map((video) => ({
    ...video,
    title: video.sourceUrl,
    date: formatDate(video.submittedAt),
    likesLabel: video.likes === null ? "抓取中" : `${video.likes.toLocaleString()} 赞`,
    pointsLabel: video.points > 0 ? `+${video.points.toLocaleString()}` : video.status === "PROCESSING" ? "处理中" : "0",
  }));
  return (
    <>
      <div className="member-content">
      <section className="page-header-row">
        <div>
          <span className="eyebrow">CONTENT CONTRIBUTION</span>
          <h1 className="page-title">我的视频</h1>
        </div>
        <button className="primary-button compact-button" onClick={() => onOpen("submit")}>
          <Plus size={17} /> 提交
        </button>
      </section>

      <section className="video-summary">
        <div>
          <span>本月有效视频</span>
          <strong>{data.summary.monthlyApprovedVideos}</strong>
        </div>
        <div>
          <span>视频贡献积分</span>
          <strong>{data.summary.videoPoints.toLocaleString()}</strong>
        </div>
        <div>
          <span>平均点赞</span>
          <strong>{data.summary.averageLikes.toLocaleString()}</strong>
        </div>
      </section>

      <div className="filter-row">
        <button className={`filter-pill ${filter === "ALL" ? "active" : ""}`} onClick={() => setFilter("ALL")}>全部 <span>{data.summary.videoCounts.all}</span></button>
        <button className={`filter-pill ${filter === "APPROVED" ? "active" : ""}`} onClick={() => setFilter("APPROVED")}>已到账 <span>{data.summary.videoCounts.approved}</span></button>
        <button className={`filter-pill ${filter === "PROCESSING" ? "active" : ""}`} onClick={() => setFilter("PROCESSING")}>处理中 <span>{data.summary.videoCounts.processing}</span></button>
        <button className={`filter-pill ${filter === "EXCEPTION" ? "active" : ""}`} onClick={() => setFilter("EXCEPTION")}>异常 <span>{data.summary.videoCounts.exception}</span></button>
      </div>

      <section className="video-list">
        {rows.map((video) => (
          <article className="video-item" key={video.id}>
            <div className="video-thumb">
              <span className="play-glyph">▶</span>
              <small>{video.likesLabel}</small>
            </div>
            <div className="video-info">
              <div className="video-title-row">
                <h3>{video.title}</h3>
                {video.status === "APPROVED" && (
                  <span className="status-chip success">已到账</span>
                )}
                {video.status === "PROCESSING" && (
                  <span className="status-chip warning">处理中</span>
                )}
                {video.status === "REJECTED" && (
                  <span className="status-chip danger">已驳回</span>
                )}
              </div>
              <span className="video-date">{video.date}</span>
              <div className="video-foot">
                <span className="video-note">
                  {submittedAppeals[video.id] || video.appeals[0]?.status === "PENDING"
                    ? "申诉待复查"
                    : video.appeals[0]?.status === "APPROVED"
                      ? `申诉已通过${video.appeals[0].reviewedPoints !== null ? `，核定 ${video.appeals[0].reviewedPoints} 积分` : ""}`
                      : video.appeals[0]?.status === "REJECTED"
                        ? `申诉未通过：${video.appeals[0].reviewReason ?? "请查看处理结果"}`
                        : video.reviewReason ?? (video.status === "APPROVED" ? "作者匹配，积分已到账" : "系统正在处理")}
                </span>
                <b className={video.points > 0 ? "positive-text" : "muted-text"}>
                  {video.pointsLabel}
                </b>
              </div>
              {video.status === "REJECTED" && !video.appeals.some((appeal) => appeal.status === "PENDING") && !submittedAppeals[video.id] && (
                <button className="secondary-button compact-button appeal-button" onClick={() => { setAppealingVideo(video); setAppealError(""); }}>
                  <CircleHelp size={16} /> 申诉
                </button>
              )}
            </div>
          </article>
        ))}
        {rows.length === 0 && <p className="empty-copy">{filter === "ALL" ? "还没有提交视频，先完成第一次创作吧" : "没有符合条件的视频"}</p>}
        </section>
        <LoadMoreHistory hasMore={hasMore} loading={loadingMore} onClick={onLoadMore} />
      </div>
      {appealingVideo && (
        <ModalShell title="提交视频申诉" eyebrow="VIDEO APPEAL" onClose={() => setAppealingVideo(null)}>
          <p className="modal-lead">请说明为何该视频应当重新复查。管理员只处理已自动驳回视频的申诉。</p>
          <div className="field">
            <label htmlFor="appeal-reason">申诉理由</label>
            <textarea id="appeal-reason" value={appealReason} onChange={(event) => setAppealReason(event.target.value)} maxLength={1000} rows={5} placeholder="例如：作者名仅使用了不同装饰字符，实际为本人账号" />
          </div>
          {appealError && <p className="form-error" role="alert">{appealError}</p>}
          <button className="primary-button full-button modal-submit" disabled={appealSaving || appealReason.trim().length < 2} onClick={submitAppeal}>
            <Send size={17} /> {appealSaving ? "提交中..." : "提交申诉"}
          </button>
        </ModalShell>
      )}
    </>
  );
}

function MallView({ onOpen, onNavigate, items, balance }: { onOpen: (dialog: DialogType, gift?: DisplayGift) => void; onNavigate: (view: MemberView) => void; items: DisplayGift[]; balance: number }) {
  const [activeCategory, setActiveCategory] = useState("全部");
  const [selectedGift, setSelectedGift] = useState<DisplayGift | null>(null);
  const categories = ["全部", "实用好物", "会员权益", "团品周边"];
  return (
    <div className="member-content">
      <section className="page-header-row">
        <div>
          <span className="eyebrow">POINTS MARKET</span>
          <h1 className="page-title">积分商城</h1>
        </div>
        <button className="icon-button" aria-label="兑换记录" onClick={() => onNavigate("orders")}>
          <PackageCheck size={20} />
        </button>
      </section>
      <div className="mall-balance">
        <Coins size={18} />
        <span>可用积分</span>
        <strong>{balance.toLocaleString()}</strong>
        <button onClick={() => onOpen("transfer")}>去转账 <ChevronRight size={15} /></button>
      </div>
      <div className="category-tabs">
        {categories.map((category) => (
          <button
            key={category}
            className={activeCategory === category ? "active" : ""}
            onClick={() => setActiveCategory(category)}
          >
            {category}
          </button>
        ))}
      </div>
      <section className="gift-grid">
        {items.map((gift) => (
          <article className="gift-card" key={gift.id}>
            <div className="gift-image-wrap">
              <img src={gift.image} alt={gift.name} />
              <span className={`gift-tag ${gift.tone}`}>{gift.tag}</span>
            </div>
            <div className="gift-body">
              <h3>{gift.name}</h3>
              <div className="gift-meta">
                <strong>{gift.points.toLocaleString()}</strong>
                <span>积分</span>
                <small>剩 {gift.stock}</small>
              </div>
              <button
                className="secondary-button full-button gift-button"
                onClick={() => {
                  setSelectedGift(gift);
                  onOpen("redeem", gift);
                }}
              >
                立即兑换
              </button>
            </div>
          </article>
        ))}
        {items.length === 0 && <p className="empty-copy">商城暂时没有可兑换礼品</p>}
      </section>
      {selectedGift && (
        <div className="sr-only" aria-live="polite">
          已选择 {selectedGift.name}
        </div>
      )}
    </div>
  );
}

function AwardClaimDialog({ award, onClose, onClaimed }: { award: MemberAward; onClose: () => void; onClaimed: () => void }) {
  const [recipientName, setRecipientName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    fetch("/api/profile/recipient", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        setRecipientName(result.profile?.recipientName ?? "");
        setPhone(result.profile?.phone ?? "");
        setAddress(result.profile?.address ?? "");
      })
      .catch(() => undefined);
  }, []);
  async function claim() {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/rankings/awards/${award.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipientName, phone, address }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "领奖失败");
      onClaimed();
      onClose();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "领奖失败");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <ModalShell title="填写领奖信息" eyebrow="RANKING REWARD" onClose={onClose}>
      <div className="redeem-preview">
        <span className="success-symbol yellow-symbol"><Trophy size={28} /></span>
        <div><strong>榜单奖励</strong><span>第 {award.rank} 名 · {award.period.type === "WEEK" ? "周更新排行榜" : "月点赞量排行榜"}</span></div>
      </div>
      <p className="modal-lead">请填写收货信息，榜单奖励由管理员统一发放。</p>
      <div className="field"><label htmlFor="award-name">收货姓名</label><input id="award-name" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} /></div>
      <div className="field"><label htmlFor="award-phone">手机号</label><input id="award-phone" value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" /></div>
      <div className="field"><label htmlFor="award-address">详细地址</label><textarea id="award-address" value={address} onChange={(event) => setAddress(event.target.value)} rows={3} /></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button full-button modal-submit" disabled={submitting || !recipientName || !phone || !address} onClick={claim}>{submitting ? "正在提交..." : "确认领奖"}</button>
    </ModalShell>
  );
}

function RankView({ data }: { data: DashboardData }) {
  const [period, setPeriod] = useState("本周");
  const [ranking, setRanking] = useState(data.leaderboard.map((item) => ({ ...item, value: item.points, videoCount: 0, likes: 0 })));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [awards, setAwards] = useState<MemberAward[]>([]);
  const [selectedAward, setSelectedAward] = useState<MemberAward | null>(null);
  const kind = period === "本月" ? "month" : period === "总榜" ? "total" : "week";
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetch(`/api/rankings?type=${kind}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "榜单加载失败");
        if (active) setRanking(result.rankings ?? []);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "榜单加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind]);
  useEffect(() => {
    fetch("/api/rankings/awards", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => setAwards(result.awards ?? []))
      .catch(() => undefined);
  }, []);
  async function refreshAwards() {
    const response = await fetch("/api/rankings/awards", { cache: "no-store" });
    const result = await response.json();
    if (response.ok) setAwards(result.awards ?? []);
  }
  return (
    <div className="member-content">
      <section className="page-header-row">
        <div>
          <span className="eyebrow">CREATOR LEADERBOARD</span>
          <h1 className="page-title">创作榜单</h1>
        </div>
        <button className="icon-button" aria-label="榜单说明">
          <CircleHelp size={20} />
        </button>
      </section>
      <div className="period-tabs">
        {["本周", "本月", "总榜"].map((item) => (
          <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>
            {item}
          </button>
        ))}
      </div>
      <section className="rank-hero">
        <div className="rank-hero-copy">
          <span className="eyebrow">{period === "本周" ? "周更新排行榜" : period === "本月" ? "月点赞量排行榜" : "总积分排行榜"}</span>
          <h2>保持你的创作节奏</h2>
          <p>{period === "本周" ? "按本周提交且通过的视频数量排名" : period === "本月" ? "按本月提交视频的总点赞量排名" : "按当前积分余额排名"}</p>
        </div>
        <Trophy size={58} strokeWidth={1.3} />
      </section>
      <section className="rank-list">
        {loading && <p className="empty-copy">正在加载榜单...</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {!loading && !error && ranking.map((user) => (
          <div className={`rank-row ${user.current ? "current" : ""}`} key={user.userId}>
            <span className={`rank-number rank-${user.rank}`}>{user.rank}</span>
            <Avatar text={user.nickname.slice(0, 1)} tone={user.current ? "coral" : "teal"} imageUrl={user.avatarUrl} />
            <div className="rank-name">
              <strong>{user.nickname}</strong>
              {user.current && <span>这是你</span>}
            </div>
            <b>{(user.value ?? user.points).toLocaleString()}<small>{period === "本周" ? " 个视频" : period === "本月" ? " 赞" : " 分"}</small></b>
          </div>
        ))}
        {!loading && !error && ranking.length === 0 && <p className="empty-copy">暂时没有榜单数据</p>}
      </section>
      {awards.length > 0 && (
        <section className="profile-section">
          <div className="section-heading"><h2 className="section-title">我的榜单奖励</h2><span className="status-chip warning">{awards.filter((award) => award.status === "PENDING").length} 待处理</span></div>
          <div className="profile-menu">
            {awards.map((award) => (
              <button key={award.id} disabled={award.status !== "PENDING"} onClick={() => setSelectedAward(award)}>
                <span><Trophy size={19} />{award.period.type === "WEEK" ? "周榜" : "月榜"}第 {award.rank} 名 · 榜单奖励</span>
                <span className={`status-chip ${award.status === "FULFILLED" ? "success" : award.status === "CLAIMED" ? "teal" : "warning"}`}>{award.status === "PENDING" ? "填写信息" : award.status === "CLAIMED" ? "待发放" : "已完成"}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {selectedAward && <AwardClaimDialog award={selectedAward} onClose={() => setSelectedAward(null)} onClaimed={refreshAwards} />}
    </div>
  );
}

function LedgerView({ onBack, data, hasMore, loadingMore, onLoadMore }: { onBack: () => void; data: DashboardData; hasMore: boolean; loadingMore: boolean; onLoadMore: () => void }) {
  const income = data.ledger.filter((item) => item.amount > 0).reduce((total, item) => total + item.amount, 0);
  const expense = Math.abs(data.ledger.filter((item) => item.amount < 0).reduce((total, item) => total + item.amount, 0));
  return (
    <div className="member-content">
      <section className="page-header-row">
        <div className="back-title">
          <button className="icon-button" aria-label="返回" onClick={onBack}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <span className="eyebrow">POINTS LEDGER</span>
            <h1 className="page-title">积分明细</h1>
          </div>
        </div>
        <button className="icon-button" aria-label="筛选">
          <Search size={20} />
        </button>
      </section>
      <section className="ledger-total">
        <span>当前积分</span>
        <strong>{data.user.balance.toLocaleString()}</strong>
        <div><span>收入 {income.toLocaleString()}</span><span>支出 {expense.toLocaleString()}</span></div>
      </section>
      <div className="ledger-filter">
        <button className="active">全部</button>
        <button>收入</button>
        <button>支出</button>
        <button>近三个月</button>
      </div>
      <section className="ledger-list">
        {data.ledger.map((item) => {
          const Icon = item.amount >= 0 ? ArrowDownLeft : Gift;
          return (
            <div className="ledger-row" key={item.id}>
              <span className={`ledger-icon ${item.amount >= 0 ? "positive" : "negative"}`}>
                <Icon size={18} />
              </span>
              <div>
                <strong>{ledgerLabel(item.type, item.note)}</strong>
                <span>{formatDate(item.createdAt)}</span>
              </div>
              <b className={item.amount >= 0 ? "positive-text" : "negative-text"}>{item.amount >= 0 ? "+" : ""}{item.amount.toLocaleString()}</b>
            </div>
          );
        })}
        {data.ledger.length === 0 && <p className="empty-copy">暂时没有积分流水</p>}
      </section>
      <LoadMoreHistory hasMore={hasMore} loading={loadingMore} onClick={onLoadMore} />
    </div>
  );
}

function TransferRecordsView({ onBack, data, hasMore, loadingMore, onLoadMore }: { onBack: () => void; data: DashboardData; hasMore: boolean; loadingMore: boolean; onLoadMore: () => void }) {
  return (
    <div className="member-content">
      <section className="page-header-row">
        <div className="back-title">
          <button className="icon-button" aria-label="返回" onClick={onBack}><ArrowLeft size={20} /></button>
          <div><span className="eyebrow">TRANSFER HISTORY</span><h1 className="page-title">转账记录</h1></div>
        </div>
      </section>
      <section className="ledger-list">
        {data.transfers.map((transfer) => {
          const outgoing = transfer.senderId === data.user.id;
          const counterparty = outgoing ? transfer.receiver : transfer.sender;
          return (
            <div className="ledger-row" key={transfer.id}>
              <span className={`ledger-icon ${outgoing ? "negative" : "positive"}`}>{outgoing ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}</span>
              <div>
                <strong>{outgoing ? "转给" : "收到"} {counterparty.nickname}</strong>
                <span>{counterparty.kuaishouId} · {formatDate(transfer.createdAt)}{transfer.note ? ` · ${transfer.note}` : ""}</span>
              </div>
              <b className={outgoing ? "negative-text" : "positive-text"}>{outgoing ? "-" : "+"}{transfer.amount.toLocaleString()}</b>
            </div>
          );
        })}
        {data.transfers.length === 0 && <p className="empty-copy">暂时没有转账记录</p>}
      </section>
      <LoadMoreHistory hasMore={hasMore} loading={loadingMore} onClick={onLoadMore} />
    </div>
  );
}

function orderStatusLabel(status: string, kind: "PHYSICAL" | "CASH") {
  const labels: Record<string, string> = {
    PENDING: kind === "PHYSICAL" ? "待采购" : "待发放",
    APPROVED: kind === "PHYSICAL" ? "已下单，待采购" : "待发放",
    FULFILLED: kind === "PHYSICAL" ? "已发货" : "已发放",
    REJECTED: "已驳回",
    REFUNDED: "已退款",
  };
  return labels[status] ?? status;
}

function RedemptionRecordsView({ onBack, data, hasMore, loadingMore, onLoadMore }: { onBack: () => void; data: DashboardData; hasMore: boolean; loadingMore: boolean; onLoadMore: () => void }) {
  return (
    <div className="member-content">
      <section className="page-header-row">
        <div className="back-title">
          <button className="icon-button" aria-label="返回" onClick={onBack}><ArrowLeft size={20} /></button>
          <div><span className="eyebrow">REDEMPTION HISTORY</span><h1 className="page-title">兑换记录</h1></div>
        </div>
      </section>
      <section className="ledger-list">
        {data.orders.map((order) => (
          <div className="ledger-row" key={order.id}>
            <span className="ledger-icon negative"><PackageCheck size={18} /></span>
            <div>
              <strong>{order.gift.name}</strong>
              <span>{order.gift.kind === "CASH" ? "现金兑换" : "实物商品"} · {formatDate(order.createdAt)}</span>
            </div>
            <div className="record-side"><b className="negative-text">-{order.totalCost.toLocaleString()}</b><span className="status-chip">{orderStatusLabel(order.status, order.gift.kind)}</span>{order.gift.kind === "PHYSICAL" && order.trackingNumber && <small className="tracking-copy">快递单号：{order.trackingNumber}</small>}</div>
          </div>
        ))}
        {data.orders.length === 0 && <p className="empty-copy">暂时没有兑换记录</p>}
      </section>
      <LoadMoreHistory hasMore={hasMore} loading={loadingMore} onClick={onLoadMore} />
    </div>
  );
}

function ProfileView({ onNavigate, onOpen, data, onLogout }: { onNavigate: (view: MemberView) => void; onOpen: (dialog: DialogType) => void; data: DashboardData; onLogout: () => void }) {
  return (
    <div className="member-content">
      <section className="profile-head">
        <div className="profile-avatar-wrap">
          <Avatar text={data.user.nickname.slice(0, 1)} tone="coral" imageUrl={data.user.avatarUrl} />
          <span className="online-dot" />
        </div>
        <div className="profile-copy">
          <h1>{data.user.nickname}</h1>
          <p>快手 ID · {data.user.kuaishouId}</p>
          <span className="status-chip teal"><BadgeCheck size={13} /> 已认证成员</span>
        </div>
        <button className="icon-button" aria-label="设置"><Settings2 size={20} /></button>
      </section>
      <section className="profile-stat-row">
        <div><strong>{data.user.balance.toLocaleString()}</strong><span>当前积分</span></div>
        <div><strong>{data.summary.approvedVideos}</strong><span>有效视频</span></div>
        <div><strong>{data.summary.rank ?? "–"}</strong><span>当前排名</span></div>
      </section>
      <section className="profile-section">
        <div className="section-heading"><h2 className="section-title">我的资料</h2><button className="section-action" onClick={() => onOpen("profile")}>编辑资料</button></div>
        <div className="profile-info-list">
          <div><span>快手昵称</span><strong>{data.user.nickname}</strong></div>
          <div><span>快手 ID</span><strong>{data.user.kuaishouId}</strong></div>
          <div><span>公会状态</span><span className="status-chip teal">{data.user.guildStatus ?? "未设置"}</span></div>
        </div>
      </section>
      <section className="profile-menu">
        <button onClick={() => onNavigate("ledger")}><span><WalletCards size={19} />积分明细</span><ChevronRight size={18} /></button>
        <button onClick={() => onNavigate("transfers")}><span><Send size={19} />转账记录</span><ChevronRight size={18} /></button>
        <button onClick={() => onNavigate("orders")}><span><PackageCheck size={19} />兑换记录</span><ChevronRight size={18} /></button>
        <button onClick={() => onOpen("recipient")}><span><PackageCheck size={19} />收货与收款信息</span><ChevronRight size={18} /></button>
        <button onClick={() => onOpen("password")}><span><KeyRound size={19} />账号安全</span><ChevronRight size={18} /></button>
      </section>
      <button className="logout-button" onClick={onLogout}><LogOut size={18} />退出登录</button>
    </div>
  );
}

function ProfileEditDialog({ user, onClose }: { user: DashboardData["user"]; onClose: () => void }) {
  const [nickname, setNickname] = useState(user.nickname);
  const [confirmJoined, setConfirmJoined] = useState(user.guildStatus === "已入会");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const canConfirmJoined = user.invited || user.guildStatus === "已邀请" || user.guildStatus === "已入会";
  async function save() {
    setSaving(true);
    setError("");
    try {
      const payload: { nickname?: string; guildStatus?: "已入会" } = { nickname: nickname.trim() };
      if (confirmJoined && user.guildStatus !== "已入会") payload.guildStatus = "已入会";
      const response = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  async function uploadAvatar(file: File | undefined) {
    if (!file) return;
    setAvatarBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("avatar", file);
      const response = await fetch("/api/profile/avatar", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "头像上传失败");
      setAvatarUrl(result.user?.avatarUrl ?? null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "头像上传失败");
    } finally {
      setAvatarBusy(false);
    }
  }
  async function resetAvatar() {
    setAvatarBusy(true);
    setError("");
    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "恢复默认头像失败");
      setAvatarUrl(result.avatarUrl ?? null);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "恢复默认头像失败");
    } finally {
      setAvatarBusy(false);
    }
  }
  return (
    <ModalShell title="编辑资料" eyebrow="MY PROFILE" onClose={onClose}>
      <div className="avatar-editor">
        <Avatar text={nickname.slice(0, 1)} tone="coral" imageUrl={avatarUrl} />
        <div><strong>个人头像</strong><span>上传后自动裁剪并压缩为 WebP</span></div>
        <label className="secondary-button mini-button avatar-upload-button">{avatarBusy ? "处理中..." : "更换头像"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={avatarBusy} onChange={(event) => { void uploadAvatar(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
        {avatarUrl && <button className="text-button" type="button" disabled={avatarBusy} onClick={() => void resetAvatar()}>恢复默认</button>}
      </div>
      <div className="field"><label htmlFor="profile-nickname">快手昵称</label><input id="profile-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} /></div>
      <div className="field"><label>快手 ID</label><input value={user.kuaishouId} disabled /></div>
      {canConfirmJoined && user.guildStatus !== "已入会" && (
        <label className="confirm-check"><input type="checkbox" checked={confirmJoined} onChange={(event) => setConfirmJoined(event.target.checked)} /><span>我已确认加入妙妙剪辑团</span></label>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button full-button modal-submit" disabled={saving || !nickname.trim()} onClick={save}>{saving ? "保存中..." : "保存资料"}</button>
    </ModalShell>
  );
}

function RecipientProfileDialog({ onClose }: { onClose: () => void }) {
  const [recipientName, setRecipientName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [cashQrCodeUrl, setCashQrCodeUrl] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch("/api/profile/recipient", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "收货信息加载失败");
        setRecipientName(result.profile?.recipientName ?? "");
        setPhone(result.profile?.phone ?? "");
        setAddress(result.profile?.address ?? "");
        setCashQrCodeUrl(result.profile?.cashQrCodeUrl ?? "");
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "收货信息加载失败"));
  }, []);
  function readQrCode(file?: File) {
    if (!file) return;
    if (file.size > 2_000_000 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("请上传 2MB 以内的 PNG、JPG 或 WebP 图片");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCashQrCodeUrl(String(reader.result ?? ""));
    reader.onerror = () => setError("收款码图片读取失败");
    reader.readAsDataURL(file);
  }
  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/profile/recipient", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipientName: recipientName.trim() || null,
          phone: phone.trim() || null,
          address: address.trim() || null,
          cashQrCodeUrl: cashQrCodeUrl || null,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  return (
    <ModalShell title="收货与收款信息" eyebrow="RECIPIENT PROFILE" onClose={onClose}>
      <p className="modal-lead">保存后可在兑换礼品和榜单领奖时直接复用。</p>
      <div className="field"><label htmlFor="profile-recipient-name">收货姓名</label><input id="profile-recipient-name" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="实物商品需要填写" /></div>
      <div className="field"><label htmlFor="profile-recipient-phone">手机号</label><input id="profile-recipient-phone" value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="实物商品需要填写" /></div>
      <div className="field"><label htmlFor="profile-recipient-address">详细地址</label><textarea id="profile-recipient-address" value={address} onChange={(event) => setAddress(event.target.value)} rows={3} placeholder="实物商品需要填写" /></div>
      <div className="field"><label htmlFor="profile-cash-qr">现金收款码</label><input id="profile-cash-qr" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => readQrCode(event.target.files?.[0])} /><span className="field-hint">{cashQrCodeUrl ? "已保存收款码，可直接复用。" : "现金兑换需要上传收款码，图片不超过 2MB。"}</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button full-button modal-submit" disabled={saving} onClick={save}>{saving ? "保存中..." : "保存信息"}</button>
    </ModalShell>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "密码修改失败");
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "密码修改失败");
    } finally {
      setSaving(false);
    }
  }
  return (
    <ModalShell title="修改密码" eyebrow="ACCOUNT SECURITY" onClose={onClose}>
      <div className="field"><label htmlFor="current-password">当前密码</label><input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
      <div className="field"><label htmlFor="new-password">新密码</label><input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 8 位" /></div>
      <div className="field"><label htmlFor="confirm-password">确认新密码</label><input id="confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button full-button modal-submit" disabled={saving || !currentPassword || !newPassword || !confirmPassword} onClick={save}>{saving ? "保存中..." : "确认修改"}</button>
    </ModalShell>
  );
}

function SubmitDialog({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [error, setError] = useState("");
  async function pasteFromClipboard() {
    setError("");
    if (!navigator.clipboard?.readText) {
      setError("当前浏览器无法直接读取剪贴板，请在输入框内长按粘贴");
      return;
    }
    setPasting(true);
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) {
        setError("剪贴板中没有可粘贴的内容");
        return;
      }
      setLink(clipboardText);
      if (clipboardText.length > 2000) {
        setError("分享文案超过 2,000 字，请只保留包含快手链接的部分");
      }
    } catch {
      setError("无法读取剪贴板，请允许剪贴板权限后重试，或在输入框内长按粘贴");
    } finally {
      setPasting(false);
    }
  }
  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/videos", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ link }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "提交失败");
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <ModalShell title="提交快手视频" eyebrow="VIDEO CONTRIBUTION" onClose={onClose}>
      {!submitted ? (
        <>
          <p className="modal-lead">粘贴公开的快手视频链接或分享文案，系统会自动识别链接、读取点赞量并校验作者。</p>
          <div className="field">
            <label htmlFor="video-link">快手视频链接</label>
            <div className="input-with-icon">
              <Link2 size={18} />
              <textarea
                id="video-link"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="粘贴快手分享链接或分享文案"
                rows={4}
                maxLength={2000}
              />
              <button type="button" className="paste-button" disabled={pasting} onClick={() => void pasteFromClipboard()}>
                <ClipboardPaste size={14} /> {pasting ? "读取中" : "粘贴"}
              </button>
            </div>
            <span className="field-hint">支持短链接、长链接和分享文案。仅接受发布 7 天内且不少于 200 赞的视频。</span>
            <span className={`field-hint ${link.length > 2000 ? "negative-text" : ""}`}>{link.length.toLocaleString()} / 2,000 字</span>
          </div>
          <div className="rule-notice">
            <ShieldCheck size={18} />
            <span>作者名需要与账号快手昵称一致；已通过或审核中的视频不能重复提交，被驳回后可以再次提交。</span>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button full-button modal-submit" disabled={!link || link.length > 2000 || submitting} onClick={submit}>
            <Send size={17} /> {submitting ? "正在提交..." : "提交并开始校验"}
          </button>
        </>
      ) : (
        <div className="success-state">
          <div className="success-symbol"><ClipboardCheck size={30} /></div>
          <h3>已进入校验队列</h3>
          <p>系统正在读取点赞量和作者信息，通常需要 1–2 分钟。你可以在「我的视频」中查看进度。</p>
          <button className="primary-button full-button" onClick={onClose}>查看提交记录</button>
        </div>
      )}
    </ModalShell>
  );
}

function TransferDialog({ onClose, balance }: { onClose: () => void; balance: number }) {
  const [done, setDone] = useState(false);
  const [receiverKuaishouId, setReceiverKuaishouId] = useState("");
  const [receiver, setReceiver] = useState<{ kuaishouId: string; nickname: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function previewReceiver() {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/members/lookup?kuaishouId=${encodeURIComponent(receiverKuaishouId)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "未找到收款成员");
      setReceiver(result.member);
    } catch (lookupError) {
      setReceiver(null);
      setError(lookupError instanceof Error ? lookupError.message : "未找到收款成员");
    } finally {
      setSubmitting(false);
    }
  }
  async function transfer() {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/transfers", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ receiverKuaishouId, amount: Number(amount), note }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "转账失败");
      setDone(true);
    } catch (transferError) {
      setError(transferError instanceof Error ? transferError.message : "转账失败");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <ModalShell title="积分转账" eyebrow="POINTS TRANSFER" onClose={onClose}>
      {!done ? (
        <>
          <div className="transfer-balance"><span>可用积分</span><strong>{balance.toLocaleString()}</strong></div>
          <div className="field"><label htmlFor="receiver">收款人快手 ID</label><input id="receiver" value={receiverKuaishouId} onChange={(event) => { setReceiverKuaishouId(event.target.value); setReceiver(null); }} placeholder="输入对方快手 ID" disabled={Boolean(receiver)} /></div>
          <div className="field"><label htmlFor="amount">转账积分</label><input id="amount" value={amount} onChange={(event) => setAmount(event.target.value)} type="number" placeholder="请输入积分数量" /></div>
          <div className="field"><label htmlFor="memo">备注（选填）</label><input id="memo" value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：本周协作奖励" /></div>
          {receiver && <div className="transfer-confirm"><span>收款成员</span><strong>{receiver.nickname}</strong><small>{receiver.kuaishouId} · 将收到 {Number(amount || 0).toLocaleString()} 积分</small><button className="text-button" onClick={() => setReceiver(null)}>更换成员</button></div>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {!receiver ? <button className="primary-button full-button modal-submit" disabled={submitting || !receiverKuaishouId || !amount || !Number.isInteger(Number(amount)) || Number(amount) <= 0} onClick={previewReceiver}><Search size={17} /> {submitting ? "核对中..." : "核对收款成员"}</button> : <button className="primary-button full-button modal-submit" disabled={submitting} onClick={transfer}><Send size={17} /> {submitting ? "处理中..." : "确认转账"}</button>}
        </>
      ) : (
        <div className="success-state">
          <div className="success-symbol teal-symbol"><Send size={28} /></div>
          <h3>转账已完成</h3>
          <p>积分已安全转入对方账户，转账明细已记录。</p>
          <button className="primary-button full-button" onClick={onClose}>完成</button>
        </div>
      )}
    </ModalShell>
  );
}

function RedeemDialog({
  gift,
  onClose,
  balance,
}: {
  gift: DisplayGift | null;
  onClose: () => void;
  balance: number;
}) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [cashQrCodeUrl, setCashQrCodeUrl] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/profile/recipient", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "收货信息加载失败");
        if (active) {
          setRecipientName(result.profile?.recipientName ?? "");
          setPhone(result.profile?.phone ?? "");
          setAddress(result.profile?.address ?? "");
          setCashQrCodeUrl(result.profile?.cashQrCodeUrl ?? "");
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  function readQrCode(file?: File) {
    if (!file) return;
    if (file.size > 2_000_000) {
      setError("收款码图片不能超过 2MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCashQrCodeUrl(String(reader.result ?? ""));
    reader.onerror = () => setError("收款码图片读取失败");
    reader.readAsDataURL(file);
  }
  async function redeem() {
    if (!gift) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/redemptions", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          giftId: gift.id,
          quantity: 1,
          recipient: gift.kind === "CASH"
            ? { cashQrCodeUrl }
            : { recipientName, phone, address },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "兑换失败");
      setDone(true);
    } catch (redeemError) {
      setError(redeemError instanceof Error ? redeemError.message : "兑换失败");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <ModalShell title="确认兑换" eyebrow="REDEEM GIFT" onClose={onClose}>
      {!done && gift ? (
        <>
          <div className="redeem-preview">
            <img src={gift.image} alt={gift.name} />
            <div><strong>{gift.name}</strong><span>库存充足 · 剩余 {gift.stock} 件</span></div>
          </div>
          <div className="redeem-summary">
            <div><span>兑换所需</span><strong>{gift.points.toLocaleString()} 分</strong></div>
            <div><span>兑换后余额</span><strong>{Math.max(0, balance - gift.points).toLocaleString()} 分</strong></div>
          </div>
          {gift.kind === "CASH" ? (
            <div className="field">
              <label htmlFor="cash-qr">收款码</label>
              <input id="cash-qr" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => readQrCode(event.target.files?.[0])} />
              <span className="field-hint">{cashQrCodeUrl ? "已选择收款码，可直接复用或重新上传。" : "请上传微信或支付宝收款码，图片不超过 2MB。"}</span>
            </div>
          ) : (
            <>
              <div className="field"><label htmlFor="recipient-name">收货姓名</label><input id="recipient-name" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="请输入收货人姓名" /></div>
              <div className="field"><label htmlFor="recipient-phone">手机号</label><input id="recipient-phone" value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="请输入 11 位手机号" /></div>
              <div className="field"><label htmlFor="recipient-address">详细地址</label><textarea id="recipient-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="省、市、区县、街道和门牌号" rows={3} /></div>
            </>
          )}
          <div className="rule-notice"><PackageCheck size={18} /><span>{gift.kind === "CASH" ? "收款码会加密传输并保存，后续兑换可直接复用。" : "收货信息会安全保存，后续兑换和榜单领奖可直接复用。"}</span></div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button full-button modal-submit" disabled={submitting || (gift.kind === "CASH" ? !cashQrCodeUrl : !recipientName || !phone || !address)} onClick={redeem}><Gift size={17} /> {submitting ? "处理中..." : "确认兑换"}</button>
        </>
      ) : (
        <div className="success-state">
          <div className="success-symbol yellow-symbol"><PackageCheck size={30} /></div>
          <h3>兑换申请已提交</h3>
          <p>{gift?.kind === "PHYSICAL" ? "订单已提交，进入待采购状态；发货后会第一时间通知你。" : "订单已提交，进入待发放状态；完成后会第一时间通知你。"}</p>
          <button className="primary-button full-button" onClick={onClose}>查看订单</button>
        </div>
      )}
    </ModalShell>
  );
}

export default function MemberApp() {
  const [view, setView] = useState<MemberView>("home");
  const [dialog, setDialog] = useState<DialogType>(null);
  const [selectedGift, setSelectedGift] = useState<DisplayGift | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [weeklyChallenge, setWeeklyChallenge] = useState<WeeklyChallengeData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [historyMore, setHistoryMore] = useState({ ledger: false, videos: false, transfers: false, orders: false });
  const [historyLoading, setHistoryLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/dashboard", { cache: "no-store" }),
      fetch("/api/weekly-challenges/current", { cache: "no-store" }),
    ])
      .then(async ([response, challengeResponse]) => {
        if (response.status === 401 || challengeResponse.status === 401) {
          router.replace("/login");
          return null;
        }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "数据加载失败");
        const challengeResult = await challengeResponse.json();
        if (!challengeResponse.ok) throw new Error(challengeResult.error ?? "周挑战加载失败");
        return { dashboard: result as DashboardData, challenge: challengeResult.challenge as WeeklyChallengeData | null };
      })
      .then((result) => {
        if (active && result) {
          setDashboard(result.dashboard);
          setWeeklyChallenge(result.challenge);
          setHistoryMore({
            ledger: result.dashboard.ledger.length === 50,
            videos: result.dashboard.videos.length === 50,
            transfers: result.dashboard.transfers.length === 50,
            orders: result.dashboard.orders.length === 50,
          });
          setLoadError("");
        }
      })
      .catch((error) => {
        if (active) setLoadError(error instanceof Error ? error.message : "数据加载失败");
      });
    return () => { active = false; };
  }, [revision, router]);

  const giftRows = useMemo<DisplayGift[]>(() => {
    if (!dashboard) return [];
    return dashboard.gifts.map((gift, index) => ({
      id: gift.id,
      name: gift.name,
      points: gift.pointsCost,
      stock: gift.stock,
      kind: gift.kind,
      image: gift.imageUrl && /^(?:https?:\/\/|\/|data:image\/webp;base64,)/i.test(gift.imageUrl) ? gift.imageUrl : gifts[index % gifts.length].image,
      tag: gift.stock > 0 ? "可兑换" : "已售罄",
      tone: gifts[index % gifts.length].tone,
    }));
  }, [dashboard]);

  const openDialog = (type: DialogType) => {
    setDialog(type);
  };

  const handleNavigate = (nextView: MemberView) => {
    setView(nextView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  async function loadMoreHistory(kind: "ledger" | "videos" | "transfers" | "orders") {
    if (!dashboard || historyLoading || !historyMore[kind]) return;
    const page = Math.floor(dashboard[kind].length / 50) + 1;
    const endpoint = kind === "ledger" ? "/api/points" : kind === "videos" ? "/api/videos" : kind === "transfers" ? "/api/transfers" : "/api/redemptions";
    setHistoryLoading(true);
    try {
      const response = await fetch(`${endpoint}?page=${page}&take=50`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "记录加载失败");
      const rows = result[kind] ?? [];
      setDashboard((current) => current ? { ...current, [kind]: [...current[kind], ...rows] } : current);
      setHistoryMore((current) => ({ ...current, [kind]: rows.length === 50 }));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "记录加载失败");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function claimCurrentChallenge() {
    if (!weeklyChallenge) return;
    const response = await fetch(`/api/weekly-challenges/${weeklyChallenge.id}/claim`, {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "任务奖励领取失败");
    setRevision((value) => value + 1);
  }

  const page = useMemo(() => {
    if (!dashboard) return null;
    if (view === "videos") return <VideosView onOpen={openDialog} data={dashboard} hasMore={historyMore.videos} loadingMore={historyLoading} onLoadMore={() => void loadMoreHistory("videos")} />;
    if (view === "mall") return <MallView items={giftRows} balance={dashboard.user.balance} onNavigate={handleNavigate} onOpen={(type, gift) => { if (type === "redeem") setSelectedGift(gift ?? giftRows[0]); openDialog(type); }} />;
    if (view === "rank") return <RankView data={dashboard} />;
    if (view === "profile") return <ProfileView data={dashboard} onNavigate={handleNavigate} onOpen={openDialog} onLogout={async () => { clearNotificationPromptSession(); await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); }} />;
    if (view === "ledger") return <LedgerView data={dashboard} onBack={() => handleNavigate("home")} hasMore={historyMore.ledger} loadingMore={historyLoading} onLoadMore={() => void loadMoreHistory("ledger")} />;
    if (view === "transfers") return <TransferRecordsView data={dashboard} onBack={() => handleNavigate("profile")} hasMore={historyMore.transfers} loadingMore={historyLoading} onLoadMore={() => void loadMoreHistory("transfers")} />;
    if (view === "orders") return <RedemptionRecordsView data={dashboard} onBack={() => handleNavigate("profile")} hasMore={historyMore.orders} loadingMore={historyLoading} onLoadMore={() => void loadMoreHistory("orders")} />;
    return <HomeView data={dashboard} challenge={weeklyChallenge} onClaimChallenge={claimCurrentChallenge} onNavigate={handleNavigate} onOpen={openDialog} />;
  }, [dashboard, giftRows, router, view, weeklyChallenge]);

  if (!dashboard) {
    return (
      <main className="member-shell">
        <div className="member-app member-loading">
          <BrandMark />
          {loadError ? (
            <div className="load-error"><strong>暂时无法加载数据</strong><span>{loadError}</span><button className="primary-button" onClick={() => setRevision((value) => value + 1)}>重新加载</button></div>
          ) : <div className="loading-line" aria-label="正在加载" />}
        </div>
      </main>
    );
  }

  const closeDialog = () => {
    setDialog(null);
    setRevision((value) => value + 1);
  };

  return (
    <main className="member-shell">
      <div className="member-app">
        <header className="member-topbar">
          <BrandMark />
          <div className="topbar-actions">
            <button className="icon-button" aria-label="搜索"><Search size={19} /></button>
            <NotificationCenter onOpenDetail={(notification) => {
              if (notification.entityType === "VideoSubmission") handleNavigate("videos");
              if (notification.entityType === "RedemptionOrder") handleNavigate("orders");
              if (notification.entityType === "Transfer") handleNavigate("transfers");
              if (notification.entityType === "PointLedger") handleNavigate("ledger");
            }} />
            <Avatar text={dashboard.user.nickname.slice(0, 1)} tone="coral" imageUrl={dashboard.user.avatarUrl} />
          </div>
        </header>
        {page}
        <BottomNav active={["ledger", "transfers", "orders"].includes(view) ? "profile" : view} onChange={handleNavigate} />
      </div>
      {dialog === "submit" && <SubmitDialog onClose={closeDialog} />}
      {dialog === "transfer" && <TransferDialog balance={dashboard.user.balance} onClose={closeDialog} />}
      {dialog === "redeem" && <RedeemDialog balance={dashboard.user.balance} gift={selectedGift ?? giftRows[0] ?? null} onClose={closeDialog} />}
      {dialog === "profile" && <ProfileEditDialog user={dashboard.user} onClose={closeDialog} />}
      {dialog === "recipient" && <RecipientProfileDialog onClose={closeDialog} />}
      {dialog === "password" && <PasswordDialog onClose={closeDialog} />}
    </main>
  );
}

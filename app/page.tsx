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
  PackageCheck,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import {
  CheckCircle,
  Clock,
  Gift as PhGift,
  House,
  PlayCircle,
  Scissors,
  Trophy as PhTrophy,
  UserCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import NotificationCenter, { clearNotificationPromptSession } from "./components/NotificationCenter";
import { BrandMark, PageScene, StateMessage } from "./member/brand";
import { LedgerView, RedemptionRecordsView, TransferRecordsView } from "./member/record-views";
import { miaoAssets } from "./member/visual-assets";

type MemberView = "home" | "videos" | "mall" | "rank" | "profile" | "challenge" | "ledger" | "transfers" | "orders";

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

function formatChallengeDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function challengeStatusLabel(challenge: WeeklyChallengeData) {
  if (challenge.status === "CLAIMED") return "奖励已到账";
  if (challenge.status === "REVERSED") return "任务已撤销";
  if (challenge.status === "EXPIRED") return "本周已结束";
  if (challenge.progress.qualified) return "已经达标";
  return "正在进行";
}

function challengeProgressPercent(challenge: WeeklyChallengeData) {
  const ratios: number[] = [];
  if (challenge.targetVideoCount) ratios.push(challenge.progress.videoCount / challenge.targetVideoCount);
  if (challenge.targetLikes) ratios.push(challenge.progress.likes / challenge.targetLikes);
  if (ratios.length === 0) return 0;
  return Math.max(0, Math.min(100, Math.round(Math.min(...ratios) * 100)));
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
    VIDEO_REWARD: "切片奖励",
    TRANSFER_IN: "团友送来的积分",
    TRANSFER_OUT: "送给团友的积分",
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
    { id: "home" as const, label: "首页", icon: House },
    { id: "videos" as const, label: "切片", icon: Scissors },
    { id: "mall" as const, label: "礼物", icon: PhGift },
    { id: "rank" as const, label: "榜单", icon: PhTrophy },
    { id: "profile" as const, label: "我的", icon: UserCircle },
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
            <Icon size={25} weight={selected ? "fill" : "regular"} />
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
  data,
}: {
  onNavigate: (view: MemberView) => void;
  onOpen: (dialog: DialogType) => void;
  challenge: WeeklyChallengeData | null;
  data: DashboardData;
}) {
  const recentLedger = data.ledger.slice(0, 3);
  const progressPercent = challenge ? challengeProgressPercent(challenge) : 0;
  return (
    <div className="member-content journal-page home-page">
      <section className="journal-hero home-journal-hero">
        <Image className="hero-swoosh" src={miaoAssets.v3.heroSwoosh} alt="" width={1440} height={1080} priority />
        <Image className="hero-character" src={miaoAssets.v3.characters.home} alt={miaoAssets.master.alt} width={640} height={960} priority />
        <div className="hero-copy">
          <span className="hero-kicker">嗨，{data.user.nickname}</span>
          <div className="hero-balance">
            <span>我的积分</span>
            <strong>{data.user.balance.toLocaleString()}</strong>
          </div>
          <button className="journal-primary" onClick={() => onOpen("submit")}>
            <Plus size={21} /> 提交切片
          </button>
        </div>
      </section>

      <section className={`challenge-entry ${challenge ? "" : "is-empty"}`} aria-labelledby="weekly-challenge-title">
        <div className="challenge-entry-head">
          <div>
            <span className="journal-kicker">每周一更新</span>
            <h2 id="weekly-challenge-title">本周任务</h2>
          </div>
          {challenge && <span className={`challenge-status status-${challenge.status.toLowerCase()}`}>{challengeStatusLabel(challenge)}</span>}
        </div>
        {challenge ? (
          <>
            <button className="challenge-entry-main" onClick={() => onNavigate("challenge")} aria-label={`查看本周任务：${challenge.title}`}>
              <span>
                <strong>{challenge.title}</strong>
                <small>{challenge.description}</small>
              </span>
              <ChevronRight size={22} />
            </button>
            <div className="challenge-entry-progress">
              <div className="challenge-progress-track" aria-label={`任务完成度 ${progressPercent}%`}>
                <i style={{ width: `${progressPercent}%` }} />
              </div>
              <span>{progressPercent}%</span>
            </div>
            <div className="challenge-entry-foot">
              <span><Coins size={17} /> 完成可得 <b>{challenge.rewardPoints.toLocaleString()}</b> 积分</span>
              <button onClick={() => onNavigate("challenge")}>查看任务</button>
            </div>
          </>
        ) : (
          <button className="challenge-entry-main" onClick={() => onNavigate("challenge")}>
            <span>
              <strong>本周任务还没出现</strong>
              <small>任务开放后会显示在这里，不会影响已有积分。</small>
            </span>
            <ChevronRight size={22} />
          </button>
        )}
      </section>

      <section className="journal-section">
        <div className="journal-section-heading ruled">
          <h2>最近动态</h2>
          <button onClick={() => onNavigate("ledger")}>查看全部</button>
        </div>
        <div className="journal-timeline">
          {recentLedger.map((item) => (
            <div className="journal-timeline-row" key={item.id}>
              <span className="timeline-symbol">{item.amount >= 0 ? <ClipboardCheck size={21} /> : <Gift size={21} />}</span>
              <div>
                <strong>{ledgerLabel(item.type, item.note)}</strong>
                <span>{formatDate(item.createdAt)}</span>
              </div>
              <b className={item.amount >= 0 ? "positive-text" : ""}>
                {item.amount >= 0 ? "+" : ""}{item.amount.toLocaleString()} 积分
              </b>
            </div>
          ))}
          {recentLedger.length === 0 && <StateMessage {...miaoAssets.states.first}>还没有积分记录，提交第一条切片吧</StateMessage>}
        </div>
      </section>
    </div>
  );
}

function ChallengeView({
  challenge,
  onBack,
  onNavigate,
  onClaimChallenge,
}: {
  challenge: WeeklyChallengeData | null;
  onBack: () => void;
  onNavigate: (view: MemberView) => void;
  onClaimChallenge: () => Promise<void>;
}) {
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState("");
  const progressPercent = challenge ? challengeProgressPercent(challenge) : 0;

  async function claim() {
    setClaiming(true);
    setClaimError("");
    try {
      await onClaimChallenge();
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : "奖励没领到，请稍后再试");
    } finally {
      setClaiming(false);
    }
  }

  if (!challenge) {
    return (
      <div className="member-content challenge-page journal-record-page">
        <header className="record-header">
          <button aria-label="返回首页" onClick={onBack}><ArrowLeft size={28} /></button>
          <h1>本周任务</h1>
          <span aria-hidden="true" />
        </header>
        <section className="challenge-empty">
          <Image src={miaoAssets.v3.characters.award} alt="妙妙捧着奖杯等待新任务" width={640} height={960} priority />
          <div>
            <span className="journal-kicker">任务准备中</span>
            <h2>本周还没有任务</h2>
            <p>可能是任务还没生成，或者活动暂时没有开放。开放后会自动出现在这里。</p>
          </div>
          <button className="journal-primary" onClick={() => onNavigate("videos")}><Scissors size={20} /> 先去看看切片</button>
        </section>
      </div>
    );
  }

  const metricRows = [
    challenge.targetVideoCount ? {
      label: "已通过切片",
      current: challenge.progress.videoCount,
      target: challenge.targetVideoCount,
      baseline: challenge.baselineVideoCount,
      unit: "条",
    } : null,
    challenge.targetLikes ? {
      label: "累计点赞",
      current: challenge.progress.likes,
      target: challenge.targetLikes,
      baseline: challenge.baselineLikes,
      unit: "赞",
    } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const isEnded = ["REVERSED", "EXPIRED"].includes(challenge.status);
  const canClaim = challenge.claimable && challenge.rewardsEnabled;
  const claimed = challenge.status === "CLAIMED";

  return (
    <div className="member-content challenge-page journal-record-page">
      <header className="record-header">
        <button aria-label="返回首页" onClick={onBack}><ArrowLeft size={28} /></button>
        <h1>本周任务</h1>
        <span aria-hidden="true" />
      </header>

      <section className="challenge-hero">
        <div className="challenge-hero-copy">
          <span className={`challenge-status status-${challenge.status.toLowerCase()}`}>{challengeStatusLabel(challenge)}</span>
          <h2>{challenge.title}</h2>
          <p>{challenge.description}</p>
          <div className="challenge-reward"><Coins size={20} /> 完成可得 <b>{challenge.rewardPoints.toLocaleString()}</b> 积分</div>
        </div>
        <Image src={miaoAssets.v3.characters.award} alt="妙妙捧着奖杯为任务加油" width={640} height={960} priority />
      </section>

      <section className="challenge-progress-card" aria-labelledby="challenge-progress-title">
        <div className="challenge-section-title">
          <div>
            <span className="journal-kicker">任务进度</span>
            <h2 id="challenge-progress-title">{progressPercent}% 已完成</h2>
          </div>
          <strong>{challenge.progress.qualified ? "已达标" : "继续加油"}</strong>
        </div>
        <div className="challenge-progress-track large" aria-label={`任务完成度 ${progressPercent}%`}>
          <i style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="challenge-metrics">
          {metricRows.map((metric) => (
            <div className="challenge-metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.current.toLocaleString()} <small>/ {metric.target.toLocaleString()} {metric.unit}</small></strong>
              <small>开始任务时：{metric.baseline.toLocaleString()} {metric.unit}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="challenge-note">
        <div className="challenge-section-title ruled">
          <h2>为什么是这个目标</h2>
        </div>
        <p>{challenge.aiReason}</p>
      </section>

      <section className="challenge-details">
        <div>
          <Clock size={22} />
          <span>任务时间</span>
          <strong>{formatChallengeDate(challenge.period.periodStart)} 至 {formatChallengeDate(challenge.period.periodEnd)}</strong>
        </div>
        <div>
          <Trophy size={22} />
          <span>竞速奖励</span>
          <strong>{challenge.raceEnded ? "本周竞速已结束" : `最快达标可得 ${challenge.period.raceReward.toLocaleString()} 积分`}</strong>
        </div>
        <div>
          <Coins size={22} />
          <span>领奖截止</span>
          <strong>{formatChallengeDate(challenge.period.claimEndsAt)}</strong>
        </div>
      </section>

      {claimError && <p className="form-error challenge-claim-error" role="alert">{claimError}</p>}
      {claimed ? (
        <button className="journal-primary challenge-main-action" disabled><CheckCircle size={21} weight="fill" /> 奖励已到账</button>
      ) : canClaim ? (
        <button className="journal-primary challenge-main-action" disabled={claiming} onClick={() => void claim()}><Coins size={21} /> {claiming ? "正在领取..." : `领取 ${challenge.rewardPoints.toLocaleString()} 积分`}</button>
      ) : (
        <button className="journal-primary challenge-main-action" disabled={isEnded || challenge.progress.qualified || !challenge.rewardsEnabled} onClick={() => onNavigate("videos")}>
          {isEnded ? "任务已经结束" : !challenge.rewardsEnabled ? "奖励暂时不能领取" : challenge.progress.qualified ? "等待领取开放" : <><Scissors size={21} /> 继续提交切片</>}
        </button>
      )}
      {!claimed && !isEnded && <p className="challenge-action-note">任务完成后，请在 {formatChallengeDate(challenge.period.claimEndsAt)} 前领取奖励。</p>}

      <section className="challenge-flow" aria-labelledby="challenge-flow-title">
        <div className="challenge-section-title ruled"><h2 id="challenge-flow-title">完成后会发生什么</h2></div>
        <ol>
          <li><span>1</span><div><strong>提交切片</strong><small>视频通过后会自动计入本周进度</small></div></li>
          <li><span>2</span><div><strong>达到目标</strong><small>完成数量或点赞目标后就能领奖</small></div></li>
          <li><span>3</span><div><strong>积分到账</strong><small>领取成功后可以在积分记录里查看</small></div></li>
        </ol>
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
    pointsLabel: video.points > 0 ? `+${video.points.toLocaleString()}` : video.status === "PROCESSING" ? "检查中" : "0",
  }));
  return (
    <>
      <div className="member-content journal-page">
      <section className="compact-journal-hero videos-journal-hero">
        <div>
          <h1>我的切片</h1>
          <button className="journal-primary" onClick={() => onOpen("submit")}>
            <Plus size={20} /> 提交切片
          </button>
        </div>
        <Image src={miaoAssets.v3.characters.videos} alt={miaoAssets.actions.highlight.alt} width={520} height={520} priority />
      </section>

      <section className="journal-stats">
        <div>
          <span>本月通过</span>
          <strong>{data.summary.monthlyApprovedVideos}</strong>
        </div>
        <div>
          <span>切片积分</span>
          <strong>{data.summary.videoPoints.toLocaleString()}</strong>
        </div>
        <div>
          <span>平均点赞</span>
          <strong>{data.summary.averageLikes.toLocaleString()}</strong>
        </div>
      </section>

      <div className="journal-tabs video-tabs">
        <button className={filter === "ALL" ? "active" : ""} onClick={() => setFilter("ALL")}>全部 {data.summary.videoCounts.all}</button>
        <button className={filter === "APPROVED" ? "active" : ""} onClick={() => setFilter("APPROVED")}>已到账 {data.summary.videoCounts.approved}</button>
        <button className={filter === "PROCESSING" ? "active" : ""} onClick={() => setFilter("PROCESSING")}>正在检查 {data.summary.videoCounts.processing}</button>
        <button className={filter === "EXCEPTION" ? "active" : ""} onClick={() => setFilter("EXCEPTION")}>需要看看 {data.summary.videoCounts.exception}</button>
      </div>

      <section className="journal-section video-journal-list">
        <div className="journal-section-heading ruled"><h2>直播高光片段</h2></div>
        {rows.map((video) => (
          <article className="journal-video-row" key={video.id}>
            <div className="journal-video-thumb">
              <Image src={miaoAssets.v3.concert} alt="" width={220} height={220} />
              <PlayCircle size={42} weight="fill" aria-hidden="true" />
            </div>
            <div className="journal-video-copy">
              <h3>直播高光片段</h3>
              <span className="video-source" title={video.title}>{video.title}</span>
              <div className="video-meta-line">
                <span><Clock size={16} />{video.date}</span>
                <span>{video.likesLabel}</span>
              </div>
              <div className="video-status-line">
                <span className={`plain-status ${video.status.toLowerCase()}`}>
                  {video.status === "APPROVED" ? <CheckCircle size={17} /> : video.status === "PROCESSING" ? <Clock size={17} /> : <WarningCircle size={17} />}
                  {submittedAppeals[video.id] || video.appeals[0]?.status === "PENDING"
                    ? "说明已提交"
                    : video.status === "APPROVED" ? "已到账"
                      : video.status === "PROCESSING" ? "正在检查视频"
                        : "需要看看"}
                </span>
                <b className={video.points > 0 ? "positive-text" : "muted-text"}>
                  {video.pointsLabel}{video.points > 0 ? " 积分" : ""}
                </b>
              </div>
              {video.reviewReason && video.status !== "APPROVED" && <p className="video-review-note">{video.reviewReason}</p>}
              {video.status === "REJECTED" && !video.appeals.some((appeal) => appeal.status === "PENDING") && !submittedAppeals[video.id] && (
                <button className="journal-inline-button" onClick={() => { setAppealingVideo(video); setAppealError(""); }}>
                  <CircleHelp size={16} /> 补充说明
                </button>
              )}
            </div>
          </article>
        ))}
        {rows.length === 0 && (
          <StateMessage {...(filter === "PROCESSING" ? miaoAssets.states.checking : miaoAssets.states.first)}>
            {filter === "ALL" ? "还没有切片，试着提交第一条吧" : "这里暂时没有切片"}
          </StateMessage>
        )}
        </section>
        <LoadMoreHistory hasMore={hasMore} loading={loadingMore} onClick={onLoadMore} />
      </div>
      {appealingVideo && (
        <ModalShell title="补充说明" eyebrow="告诉我们这条切片哪里需要再看看" onClose={() => setAppealingVideo(null)}>
          <p className="modal-lead">简单说说这条切片为什么应该通过，管理员会再看一次。</p>
          <div className="field">
            <label htmlFor="appeal-reason">你的说明</label>
            <textarea id="appeal-reason" value={appealReason} onChange={(event) => setAppealReason(event.target.value)} maxLength={1000} rows={5} placeholder="例如：昵称里只是多了装饰符号，确实是妙妙的直播切片" />
          </div>
          {appealError && <p className="form-error" role="alert">{appealError}</p>}
          <button className="primary-button full-button modal-submit" disabled={appealSaving || appealReason.trim().length < 2} onClick={submitAppeal}>
            <Send size={17} /> {appealSaving ? "正在提交..." : "提交说明"}
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
    <div className="member-content journal-page">
      <section className="compact-journal-hero mall-journal-hero">
        <div>
          <span className="journal-kicker">用努力换一份小惊喜</span>
          <h1>积分礼物屋</h1>
          <div className="mall-points">
            <span>可用积分</span>
            <strong>{balance.toLocaleString()}</strong>
          </div>
        </div>
        <Image src={miaoAssets.v3.characters.gift} alt={miaoAssets.actions.gift.alt} width={520} height={520} priority />
        <button className="journal-record-link" onClick={() => onNavigate("orders")}>
          兑换记录 <ChevronRight size={17} />
        </button>
      </section>
      <div className="journal-tabs category-tabs">
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
      <section className="journal-gift-grid">
        {items.map((gift) => (
          <article className="journal-gift-card" key={gift.id}>
            <div className="gift-image-wrap">
              <img src={gift.image} alt={gift.name} />
            </div>
            <div className="gift-body">
              <h3>{gift.name}</h3>
              <div className="gift-meta">
                <strong>{gift.points.toLocaleString()}</strong>
                <span>积分</span>
                <small>剩 {gift.stock}</small>
              </div>
              <button
                className="journal-outline-button"
                disabled={gift.stock <= 0 || balance < gift.points}
                onClick={() => {
                  setSelectedGift(gift);
                  onOpen("redeem", gift);
                }}
              >
                {gift.stock > 0 ? (balance >= gift.points ? "查看" : `差 ${(gift.points - balance).toLocaleString()} 分`) : "已售罄"}
              </button>
            </div>
          </article>
        ))}
        {items.length === 0 && <StateMessage {...miaoAssets.actions.gift}>礼物屋正在补货，晚点再来看看吧</StateMessage>}
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
    <ModalShell title="填写领奖信息" eyebrow="把礼物送到正确的地方" onClose={onClose}>
      <div className="redeem-preview">
        <span className="success-symbol yellow-symbol"><Trophy size={28} /></span>
        <div><strong>榜单奖励</strong><span>第 {award.rank} 名 · {award.period.type === "WEEK" ? "周更新排行榜" : "月点赞量排行榜"}</span></div>
      </div>
      <p className="modal-lead">填好收货信息后，管理员会统一寄出榜单礼物。</p>
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
    <div className="member-content journal-page">
      <section className="compact-journal-hero rank-journal-hero">
        <div>
          <span className="journal-kicker">每一条高光都算数</span>
          <h1>剪辑团榜单</h1>
          <p>看看谁剪出了最多精彩片段</p>
        </div>
        <Image src={miaoAssets.v3.characters.award} alt={miaoAssets.actions.award.alt} width={520} height={520} priority />
      </section>
      <div className="journal-tabs period-tabs">
        {["本周", "本月", "总榜"].map((item) => (
          <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>
            {item}
          </button>
        ))}
      </div>
      <section className="journal-rank-list">
        {loading && <p className="empty-copy">正在整理榜单...</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {!loading && !error && ranking.map((user) => (
          <div className={`journal-rank-row ${user.current ? "current" : ""}`} key={user.userId}>
            <span className={`rank-number rank-${user.rank}`}>{user.rank}</span>
            <Avatar text={user.nickname.slice(0, 1)} tone={user.current ? "coral" : "teal"} imageUrl={user.avatarUrl} />
            <div className="rank-name">
              <strong>{user.nickname}</strong>
              {user.current && <span>这是你</span>}
            </div>
            <b>{(user.value ?? user.points).toLocaleString()}<small>{period === "本周" ? " 条切片" : period === "本月" ? " 赞" : " 分"}</small></b>
          </div>
        ))}
        {!loading && !error && ranking.length === 0 && <StateMessage {...miaoAssets.actions.award}>榜单还没有人，提交第一条切片吧</StateMessage>}
      </section>
      {awards.length > 0 && (
        <section className="journal-section award-section">
          <div className="journal-section-heading ruled"><h2>我的榜单奖励</h2><span>{awards.filter((award) => award.status === "PENDING").length} 份待领取</span></div>
          <div className="journal-menu">
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

function ProfileView({ onNavigate, onOpen, data, onLogout }: { onNavigate: (view: MemberView) => void; onOpen: (dialog: DialogType) => void; data: DashboardData; onLogout: () => void }) {
  return (
    <div className="member-content journal-page profile-journal-page">
      <section className="journal-profile-head">
        <div className="profile-avatar-wrap">
          <Avatar text={data.user.nickname.slice(0, 1)} tone="coral" imageUrl={data.user.avatarUrl} />
          <span className="online-dot" />
        </div>
        <div className="profile-copy">
          <h1>{data.user.nickname}</h1>
          <p title={data.user.kuaishouId}>快手 ID · {data.user.kuaishouId}</p>
          <span className="plain-member-status"><BadgeCheck size={15} /> 剪辑团成员</span>
        </div>
        <button className="journal-text-action" onClick={() => onOpen("profile")}>修改资料</button>
      </section>
      <section className="journal-profile-stats">
        <div><strong>{data.user.balance.toLocaleString()}</strong><span>当前积分</span></div>
        <div><strong>{data.summary.approvedVideos}</strong><span>通过的切片</span></div>
        <div><strong>{data.summary.rank ?? "–"}</strong><span>榜单名次</span></div>
      </section>

      <section className="journal-section profile-action-section">
        <div className="journal-section-heading ruled"><h2>常用操作</h2></div>
        <div className="journal-profile-actions">
          <button onClick={() => onOpen("transfer")}><Send size={20} /><span>送积分给团友</span><ChevronRight size={18} /></button>
          <button onClick={() => onOpen("recipient")}><PackageCheck size={20} /><span>收货与收款信息</span><ChevronRight size={18} /></button>
        </div>
      </section>

      <section className="journal-section">
        <div className="journal-section-heading ruled"><h2>记录</h2></div>
        <div className="journal-menu">
        <button aria-label="积分记录" onClick={() => onNavigate("ledger")}><span><WalletCards size={19} />积分记录</span><ChevronRight size={18} /></button>
        <button aria-label="送积分记录" onClick={() => onNavigate("transfers")}><span><Send size={19} />送积分记录</span><ChevronRight size={18} /></button>
        <button aria-label="兑换记录" onClick={() => onNavigate("orders")}><span><PackageCheck size={19} />兑换记录</span><ChevronRight size={18} /></button>
        </div>
      </section>
      <section className="journal-section">
        <div className="journal-section-heading ruled"><h2>账号</h2></div>
        <div className="journal-menu">
          <button aria-label="账号安全" onClick={() => onOpen("password")}><span><KeyRound size={19} />账号安全</span><ChevronRight size={18} /></button>
        </div>
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
    <ModalShell title="修改我的信息" eyebrow="昵称和头像会显示在剪辑团里" onClose={onClose}>
      <div className="avatar-editor">
        <Avatar text={nickname.slice(0, 1)} tone="coral" imageUrl={avatarUrl} />
        <div><strong>我的头像</strong><span>上传后会自动裁成合适的大小</span></div>
        <label className="secondary-button mini-button avatar-upload-button">{avatarBusy ? "正在准备..." : "更换头像"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={avatarBusy} onChange={(event) => { void uploadAvatar(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
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
    <ModalShell title="收货与收款信息" eyebrow="兑换礼物时会用到" onClose={onClose}>
      <p className="modal-lead">保存一次，以后兑换礼物和领奖时就不用重复填写。</p>
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
    <ModalShell title="修改密码" eyebrow="换一个只有你知道的新密码" onClose={onClose}>
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
      const clipboardText = await Promise.race([
        navigator.clipboard.readText(),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error("clipboard-timeout")), 4000);
        }),
      ]);
      if (!clipboardText.trim()) {
        setError("剪贴板中没有可粘贴的内容");
        return;
      }
      setLink(clipboardText);
      if (clipboardText.length > 2000) {
        setError("分享文案超过 2,000 字，请只保留包含快手链接的部分");
      }
    } catch {
      setError("没能读取剪贴板，请长按输入框粘贴链接");
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
    <ModalShell title="提交直播切片" eyebrow="把快手分享内容粘贴到这里" onClose={onClose}>
      {!submitted ? (
        <>
          <p className="modal-lead">粘贴快手链接或整段分享内容，我们会帮你找到视频并检查点赞数。</p>
          <div className="field">
            <label htmlFor="video-link">快手链接或分享内容</label>
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
            <span className="field-hint">短链接、长链接和整段分享内容都可以。切片需要在 7 天内发布，并且至少有 200 个赞。</span>
            <span className={`field-hint ${link.length > 2000 ? "negative-text" : ""}`}>{link.length.toLocaleString()} / 2,000 字</span>
          </div>
          <div className="rule-notice">
            <ShieldCheck size={18} />
            <span>视频昵称要和你填写的快手昵称一致。正在检查或已经通过的切片不能重复提交，未通过后可以再试一次。</span>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button full-button modal-submit" disabled={!link || link.length > 2000 || submitting} onClick={submit}>
            <Send size={17} /> {submitting ? "正在提交..." : "提交切片"}
          </button>
        </>
      ) : (
        <div className="success-state">
          <div className="success-symbol"><ClipboardCheck size={30} /></div>
          <h3>提交成功啦</h3>
          <p>我们正在检查视频和点赞数，一般需要 1–2 分钟。可以去「我的切片」看看进度。</p>
          <button className="primary-button full-button" onClick={onClose}>查看我的切片</button>
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
  const numericAmount = Number(amount);
  const amountTooHigh = Number.isFinite(numericAmount) && numericAmount > balance;
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
    <ModalShell title="送积分给团友" eyebrow="先确认对方的快手 ID" onClose={onClose}>
      {!done ? (
        <>
          <div className="transfer-balance"><span>可用积分</span><strong>{balance.toLocaleString()}</strong></div>
          <div className="field"><label htmlFor="receiver">团友的快手 ID</label><input id="receiver" value={receiverKuaishouId} onChange={(event) => { setReceiverKuaishouId(event.target.value); setReceiver(null); }} placeholder="输入对方的快手 ID" disabled={Boolean(receiver)} /></div>
          <div className="field">
            <label htmlFor="amount">送多少积分</label>
            <input id="amount" value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min={1} step={1} placeholder="输入整数积分" />
            {amountTooHigh && <span className="field-hint negative-text">积分不够，请输入不超过 {balance.toLocaleString()} 的整数</span>}
          </div>
          <div className="field"><label htmlFor="memo">备注（选填）</label><input id="memo" value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：本周协作奖励" /></div>
          {receiver && <div className="transfer-confirm"><span>请确认这位团友</span><strong>{receiver.nickname}</strong><small>{receiver.kuaishouId} · 会收到 {Number(amount || 0).toLocaleString()} 积分</small><button className="text-button" onClick={() => setReceiver(null)}>换一个人</button></div>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {!receiver ? <button className="primary-button full-button modal-submit" disabled={submitting || !receiverKuaishouId || !amount || !Number.isInteger(numericAmount) || numericAmount <= 0 || amountTooHigh} onClick={previewReceiver}><Search size={17} /> {amountTooHigh ? "积分不够" : submitting ? "正在查找..." : "找到这位团友"}</button> : <button className="primary-button full-button modal-submit" disabled={submitting || !Number.isInteger(numericAmount) || numericAmount <= 0 || amountTooHigh} onClick={transfer}><Send size={17} /> {amountTooHigh ? "积分不够" : submitting ? "正在送出..." : "确认送出"}</button>}
        </>
      ) : (
        <div className="success-state">
          <div className="success-symbol teal-symbol"><Send size={28} /></div>
          <h3>积分送到啦</h3>
          <p>积分已经送给对方，这次记录也保存好了。</p>
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
    <ModalShell title="确认兑换" eyebrow="检查礼物和收货信息" onClose={onClose}>
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
          <div className="rule-notice"><PackageCheck size={18} /><span>{gift.kind === "CASH" ? "收款码会安全保存，下次兑换可以直接使用。" : "收货信息会安全保存，下次兑换和领奖可以直接使用。"}</span></div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button full-button modal-submit" disabled={submitting || (gift.kind === "CASH" ? !cashQrCodeUrl : !recipientName || !phone || !address)} onClick={redeem}><Gift size={17} /> {submitting ? "正在兑换..." : "确认兑换"}</button>
        </>
      ) : (
        <div className="success-state">
          <div className="success-symbol yellow-symbol"><PackageCheck size={30} /></div>
          <h3>兑换成功啦</h3>
          <p>{gift?.kind === "PHYSICAL" ? "申请已经收好，礼物发出后会通知你。" : "申请已经收好，积分礼物准备好后会通知你。"}</p>
          <button className="primary-button full-button" onClick={onClose}>查看兑换记录</button>
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
    window.scrollTo({ top: 0, behavior: "auto" });
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
    if (view === "challenge") return <ChallengeView challenge={weeklyChallenge} onBack={() => handleNavigate("home")} onNavigate={handleNavigate} onClaimChallenge={claimCurrentChallenge} />;
    if (view === "ledger") return <LedgerView data={dashboard} onBack={() => handleNavigate("home")} hasMore={historyMore.ledger} loadingMore={historyLoading} onLoadMore={() => void loadMoreHistory("ledger")} />;
    if (view === "transfers") return <TransferRecordsView data={dashboard} onBack={() => handleNavigate("profile")} hasMore={historyMore.transfers} loadingMore={historyLoading} onLoadMore={() => void loadMoreHistory("transfers")} />;
    if (view === "orders") return <RedemptionRecordsView data={dashboard} onBack={() => handleNavigate("profile")} hasMore={historyMore.orders} loadingMore={historyLoading} onLoadMore={() => void loadMoreHistory("orders")} />;
    return <HomeView data={dashboard} challenge={weeklyChallenge} onNavigate={handleNavigate} onOpen={openDialog} />;
  }, [dashboard, giftRows, router, view, weeklyChallenge]);

  if (!dashboard) {
    return (
      <main className="member-shell">
        <div className="member-app member-loading">
          <BrandMark />
          {loadError ? (
            <div className="load-error">
              <PageScene {...miaoAssets.states.failed} />
              <strong>页面暂时没加载出来</strong>
              <span>{loadError}，可以再试一次。</span>
              <button className="primary-button" onClick={() => setRevision((value) => value + 1)}>再试一次</button>
            </div>
          ) : <div className="loading-line" aria-label="正在加载" />}
        </div>
      </main>
    );
  }

  const closeDialog = () => {
    setDialog(null);
    setRevision((value) => value + 1);
  };
  const secondaryView = ["challenge", "ledger", "transfers", "orders"].includes(view);
  const navigationView: MemberView = view === "challenge" || view === "ledger"
    ? "home"
    : view === "transfers" || view === "orders"
      ? "profile"
      : view;

  return (
    <main className="member-shell">
      <div className={`member-app ${secondaryView ? "secondary-page" : ""}`}>
        <header className="member-topbar">
          <BrandMark />
          <div className="topbar-actions">
            <NotificationCenter onOpenDetail={(notification) => {
              if (notification.entityType === "VideoSubmission") handleNavigate("videos");
              if (notification.entityType === "RedemptionOrder") handleNavigate("orders");
              if (notification.entityType === "Transfer") handleNavigate("transfers");
              if (notification.entityType === "PointLedger") handleNavigate("ledger");
              if (notification.entityType === "WeeklyChallengeAssignment") handleNavigate("challenge");
            }} />
            <Avatar text={dashboard.user.nickname.slice(0, 1)} tone="coral" imageUrl={dashboard.user.avatarUrl} />
          </div>
        </header>
        {page}
        <BottomNav active={navigationView} onChange={handleNavigate} />
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

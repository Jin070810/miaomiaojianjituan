"use client";

import { AlertTriangle, ArrowLeft, Check, ChevronDown, ExternalLink, RefreshCw, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { canonicalKuaishouVideoUrl } from "@/lib/kuaishou-url";

type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED";
type Pagination = { page: number; take: number; total: number; pages: number };
type SecondaryReview = {
  id: string;
  status: ReviewStatus;
  reviewReason: string | null;
  assignedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  reviewer: { id: string; kuaishouId: string; nickname: string; role: string } | null;
  video: {
    id: string;
    sourceUrl: string;
    photoId: string | null;
    likes: number | null;
    points: number;
    caption: string | null;
    coverUrl: string | null;
    submittedAt: string;
    user: { id: string; kuaishouId: string; nickname: string };
  };
};

const statusLabels: Record<ReviewStatus, string> = {
  PENDING: "待二审",
  APPROVED: "已通过",
  REJECTED: "已驳回",
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function videoHref(review: SecondaryReview) {
  return canonicalKuaishouVideoUrl(review.video.photoId) ?? review.video.sourceUrl;
}

export default function ReviewerPage() {
  const [status, setStatus] = useState<ReviewStatus>("PENDING");
  const [reviews, setReviews] = useState<SecondaryReview[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, take: 50, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  async function load(nextStatus = status, page = 1, append = false) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ status: nextStatus, page: String(page), take: String(pagination.take) });
      const response = await fetch(`/api/reviewer/video-reviews?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "二次审核池加载失败");
      setStatus(nextStatus);
      setReviews((current) => append ? [...current, ...(result.reviews ?? [])] : (result.reviews ?? []));
      setPagination(result.pagination);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "二次审核池加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function reviewVideo(review: SecondaryReview, action: "approve" | "reject") {
    const reason = action === "reject" ? window.prompt("请输入二审驳回原因，系统会扣回该视频已到账积分。")?.trim() : undefined;
    if (action === "reject" && !reason) return;
    if (!window.confirm(action === "approve" ? "确认二审通过该视频？" : `确认驳回并扣回 ${review.video.points} 积分？`)) return;
    setBusyId(review.id);
    setError("");
    setFeedback("");
    try {
      const response = await fetch(`/api/reviewer/video-reviews/${review.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "二次审核操作失败");
      setReviews((current) => current.filter((item) => item.id !== review.id));
      setPagination((current) => ({ ...current, total: Math.max(0, current.total - 1) }));
      setFeedback(action === "approve" ? "二审已通过。" : "二审已驳回，积分已扣回。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "二次审核操作失败");
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    void load("PENDING");
  }, []);

  return (
    <main className="reviewer-shell">
      <section className="reviewer-page">
        <header className="reviewer-header">
          <Link href="/" className="reviewer-back" aria-label="返回成员首页"><ArrowLeft size={18} />返回</Link>
          <div><span className="eyebrow">SECOND REVIEW</span><h1>视频二次审核台</h1><p>逐条打开视频核查；驳回会自动扣回已到账积分。</p></div>
          <button className="icon-button" title="刷新" aria-label="刷新二次审核池" onClick={() => void load(status)}><RefreshCw size={18} /></button>
        </header>
        <div className="reviewer-tabs">
          {(["PENDING", "APPROVED", "REJECTED"] as const).map((item) => (
            <button key={item} className={status === item ? "active" : ""} onClick={() => void load(item)}>{statusLabels[item]}</button>
          ))}
        </div>
        {feedback && <p className="reviewer-feedback success" role="status"><ShieldCheck size={17} />{feedback}</p>}
        {error && <p className="reviewer-feedback error" role="alert"><AlertTriangle size={17} />{error}</p>}
        {loading && reviews.length === 0 ? (
          <section className="reviewer-state" role="status"><RefreshCw size={24} /><strong>正在加载二审任务...</strong></section>
        ) : reviews.length === 0 ? (
          <section className="reviewer-state"><ShieldCheck size={24} /><strong>暂无{statusLabels[status]}任务</strong><span>切换状态可查看历史处理记录。</span></section>
        ) : (
          <div className="reviewer-list">
            {reviews.map((review) => (
              <article className="reviewer-item" key={review.id}>
                {review.video.coverUrl ? <img src={review.video.coverUrl} alt="" /> : <span className="reviewer-thumb">▶</span>}
                <div>
                  <strong>{review.video.caption || review.video.sourceUrl}</strong>
                  <span>{review.video.user.nickname} · {review.video.user.kuaishouId}</span>
                  <small>{review.video.likes?.toLocaleString() ?? "未获取"} 赞 · {review.video.points.toLocaleString()} 积分 · 提交于 {formatDate(review.video.submittedAt)}</small>
                  {review.reviewReason && <small className="reviewer-reason">原因：{review.reviewReason}</small>}
                </div>
                <span className={`status-chip ${review.status === "APPROVED" ? "success" : review.status === "REJECTED" ? "danger" : "warning"}`}>{statusLabels[review.status]}</span>
                <div className="reviewer-actions">
                  <a className="secondary-button mini-button" href={videoHref(review)} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />打开视频</a>
                  {review.status === "PENDING" && <button className="secondary-button mini-button" disabled={busyId === review.id} onClick={() => void reviewVideo(review, "approve")}><Check size={15} />通过</button>}
                  {review.status === "PENDING" && <button className="danger-button mini-button" disabled={busyId === review.id} onClick={() => void reviewVideo(review, "reject")}><X size={15} />驳回</button>}
                </div>
              </article>
            ))}
          </div>
        )}
        {pagination.page < pagination.pages && <button className="secondary-button full-button" onClick={() => void load(status, pagination.page + 1, true)}>加载更多 <ChevronDown size={15} /></button>}
      </section>
    </main>
  );
}

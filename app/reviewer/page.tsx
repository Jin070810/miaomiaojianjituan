"use client";

import "../admin/admin-theme.css";

import { AlertTriangle, ArrowLeft, ChevronDown, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { canonicalVideoUrl } from "@/lib/kuaishou-url";

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
    sourceKind: string;
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
  PENDING: "历史未处理",
  APPROVED: "已通过",
  REJECTED: "已驳回",
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function videoHref(review: SecondaryReview) {
  return canonicalVideoUrl(review.video.sourceKind, review.video.photoId) ?? review.video.sourceUrl;
}

export default function ReviewerPage() {
  const [status, setStatus] = useState<ReviewStatus>("PENDING");
  const [reviews, setReviews] = useState<SecondaryReview[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, take: 50, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(nextStatus = status, page = 1, append = false) {
    setLoading(true);
    setStatus(nextStatus);
    setError("");
    try {
      const params = new URLSearchParams({ status: nextStatus, page: String(page), take: String(pagination.take) });
      const response = await fetch(`/api/reviewer/video-reviews?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "历史记录加载失败");
      setReviews((current) => append ? [...current, ...(result.reviews ?? [])] : (result.reviews ?? []));
      setPagination(result.pagination);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "历史记录加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load("PENDING");
  }, []);

  return (
    <main className="reviewer-shell">
      <section className="reviewer-page" aria-busy={loading}>
        <header className="reviewer-header">
          <Link href="/" className="reviewer-back" aria-label="返回成员首页"><ArrowLeft size={18} />返回</Link>
          <div><span className="eyebrow">REVIEW HISTORY</span><h1>历史二审记录</h1><p>普通视频自动审核；此处仅供查询历史二审记录，人工仅处理成员申诉。</p><Link className="reviewer-back" href="/registration-support">入团申请审核</Link></div>
          <button className="icon-button" title="刷新" aria-label="刷新历史记录" disabled={loading} onClick={() => void load(status)}><RefreshCw size={18} /></button>
        </header>
        <div className="reviewer-tabs">
          {(["PENDING", "APPROVED", "REJECTED"] as const).map((item) => (
            <button key={item} disabled={loading} className={status === item ? "active" : ""} onClick={() => void load(item)}>{statusLabels[item]}</button>
          ))}
        </div>
        {error && <p className="reviewer-feedback error" role="alert"><AlertTriangle size={17} />{error}</p>}
        {error ? null : loading && reviews.length === 0 ? (
          <section className="reviewer-state" role="status"><RefreshCw size={24} /><strong>正在加载历史记录...</strong></section>
        ) : reviews.length === 0 ? (
          <section className="reviewer-state"><ShieldCheck size={24} /><strong>暂无{statusLabels[status]}记录</strong><span>切换状态可查看历史处理记录。</span></section>
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
                </div>
              </article>
            ))}
          </div>
        )}
        {pagination.page < pagination.pages && <button disabled={loading} className="secondary-button full-button" onClick={() => void load(status, pagination.page + 1, true)}>加载更多 <ChevronDown size={15} /></button>}
      </section>
    </main>
  );
}

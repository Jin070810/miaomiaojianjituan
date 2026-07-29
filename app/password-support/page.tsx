"use client";

import { CheckCircle, Clock, ShieldCheck, XCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ResetRequest = {
  id: string;
  createdAt: string;
  expiresAt: string;
  user: { nickname: string; kuaishouId: string };
};

export default function PasswordSupportPage() {
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const router = useRouter();

  async function load() {
    setLoading(true);
    setError("");
    const response = await fetch("/api/password-support/requests", { cache: "no-store" });
    const result = await response.json();
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    if (!response.ok) {
      setError(result.error ?? "密码找回申请加载失败");
      setLoading(false);
      return;
    }
    setRequests(result.requests);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function review(id: string, action: "APPROVE" | "REJECT") {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/password-support/requests/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "处理失败");
      setRequests((current) => current.filter((request) => request.id !== id));
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "处理失败");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="member-shell">
      <div className="member-app secondary-page">
        <div className="member-content journal-page">
          <section className="journal-profile-head">
            <div className="profile-copy"><span className="eyebrow">PASSWORD SUPPORT</span><h1>密码协助中心</h1><p>线下核验身份后再批准申请；新密码不会在这里显示。</p></div>
            <Link className="journal-text-action" href="/">返回成员端</Link>
          </section>
          <section className="journal-section">
            <div className="journal-section-heading ruled"><h2>待审批申请</h2></div>
            <p className="field-hint"><ShieldCheck size={16} /> 批准后会立即使该成员全部旧登录会话失效。</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            {loading ? <div className="loading-line" aria-label="正在加载" /> : requests.length === 0 ? <p className="empty-copy">暂无待处理的密码找回申请。</p> : <div className="journal-menu">{requests.map((request) => <article key={request.id} className="password-support-request"><div><strong>{request.user.nickname}</strong><small>{request.user.kuaishouId} · 申请于 {new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(request.createdAt))}</small><small><Clock size={14} /> 截止 {new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(request.expiresAt))}</small></div><div className="table-actions-inline"><button className="secondary-button compact-button" disabled={busyId === request.id} onClick={() => void review(request.id, "REJECT")}><XCircle size={16} />拒绝</button><button className="primary-button compact-button" disabled={busyId === request.id} onClick={() => void review(request.id, "APPROVE")}><CheckCircle size={16} />{busyId === request.id ? "处理中..." : "批准"}</button></div></article>)}</div>}
          </section>
        </div>
      </div>
    </main>
  );
}

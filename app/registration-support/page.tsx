"use client";

import { AlertTriangle, ArrowLeft, Check, RefreshCw, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Status = "PENDING" | "APPROVED" | "REJECTED";
type Application = { id: string; kuaishouId: string; nickname: string; guildStatus: string | null; boundPhone: string | null; status: Status; reviewReason: string | null; reviewedAt: string | null; createdAt: string; reviewedBy: { id: string; nickname: string; role: string } | null };

const labels: Record<Status, string> = { PENDING: "待审核", APPROVED: "已通过", REJECTED: "已驳回" };

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "-";
}

export default function RegistrationSupportPage() {
  const [status, setStatus] = useState<Status>("PENDING");
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  async function load(nextStatus = status) {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/registration-support/applications?status=${nextStatus}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "入团申请加载失败");
      setApplications(result.applications ?? []); setStatus(nextStatus);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "入团申请加载失败"); } finally { setLoading(false); }
  }

  async function review(application: Application, action: "APPROVE" | "REJECT") {
    const reason = action === "REJECT" ? window.prompt("请输入驳回原因，申请人会看到这段说明。")?.trim() : undefined;
    if (action === "REJECT" && !reason) return;
    if (!window.confirm(action === "APPROVE" ? `确认通过 ${application.nickname} 的入团申请？` : `确认驳回 ${application.nickname} 的入团申请？`)) return;
    setBusyId(application.id); setError(""); setFeedback("");
    try {
      const response = await fetch(`/api/registration-support/applications/${application.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, reason }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "审核失败");
      setApplications((current) => current.filter((item) => item.id !== application.id));
      setFeedback(action === "APPROVE" ? "申请已通过，成员账号和积分账户已创建。" : "申请已驳回，申请人可以修改后重新提交。");
    } catch (reviewError) { setError(reviewError instanceof Error ? reviewError.message : "审核失败"); } finally { setBusyId(null); }
  }

  useEffect(() => { void load("PENDING"); }, []);

  return <main className="reviewer-shell"><section className="reviewer-page"><header className="reviewer-header"><Link href="/" className="reviewer-back" aria-label="返回成员首页"><ArrowLeft size={18} />返回</Link><div><span className="eyebrow">REGISTRATION REVIEW</span><h1>入团申请审核</h1><p>审核通过后才会创建成员账号和积分账户。</p></div><button className="icon-button" title="刷新" aria-label="刷新入团申请" onClick={() => void load()}><RefreshCw size={18} /></button></header><div className="reviewer-tabs">{(Object.keys(labels) as Status[]).map((item) => <button key={item} className={status === item ? "active" : ""} onClick={() => void load(item)}>{labels[item]}</button>)}</div>{feedback && <p className="reviewer-feedback success" role="status"><ShieldCheck size={17} />{feedback}</p>}{error && <p className="reviewer-feedback error" role="alert"><AlertTriangle size={17} />{error}</p>}{loading ? <section className="reviewer-state" role="status"><RefreshCw size={24} /><strong>正在加载入团申请...</strong></section> : applications.length === 0 ? <section className="reviewer-state"><ShieldCheck size={24} /><strong>暂无{labels[status]}申请</strong><span>新的申请会出现在这里。</span></section> : <div className="reviewer-list">{applications.map((application) => <article className="reviewer-item registration-review-item" key={application.id}><div><strong>{application.nickname}</strong><span>快手 ID：{application.kuaishouId}</span><small>公会状态：{application.guildStatus ?? "未设置"} · 手机号：{application.boundPhone ?? "未填写"}</small><small>提交于 {formatDate(application.createdAt)}{application.reviewedBy ? ` · ${application.reviewedBy.nickname}处理` : ""}</small>{application.reviewReason && <small className="reviewer-reason">原因：{application.reviewReason}</small>}</div><span className={`status-chip ${application.status === "APPROVED" ? "success" : application.status === "REJECTED" ? "danger" : "warning"}`}>{labels[application.status]}</span><div className="reviewer-actions">{application.status === "PENDING" && <><button className="secondary-button mini-button" disabled={busyId === application.id} onClick={() => void review(application, "APPROVE")}><Check size={15} />通过</button><button className="danger-button mini-button" disabled={busyId === application.id} onClick={() => void review(application, "REJECT")}><X size={15} />驳回</button></>}</div></article>)}</div>}</section></main>;
}

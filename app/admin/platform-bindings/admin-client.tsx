"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { bindingDate, bindingJson, bindingRequestStatus, platformLabel } from "../../account-bindings/client-api";
import styles from "../../account-bindings/bindings.module.css";
import { canonicalVideoUrl } from "@/lib/kuaishou-url";

type ReviewRow = {
  id: string; platform: string; authorUid: string; photoId: string; status: string; expiresAt: string;
  proofMethod: string | null; proofNote: string | null; rejectionReason: string | null;
  user: { id: string; nickname: string; kuaishouId: string; active: boolean };
  binding: { id: string; revokedAt: string | null } | null;
};
type ReviewData = { requests: ReviewRow[]; pagination: { page: number; pages: number; total: number } };

function ReviewCard({ row, actorId, onDone }: { row: ReviewRow; actorId: string; onDone: () => void }) {
  const [challenge, setChallenge] = useState("");
  const [method, setMethod] = useState("PLATFORM_MESSAGE");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const expired = new Date(row.expiresAt).getTime() <= Date.now();
  const self = row.user.id === actorId;
  async function act(action: "approve" | "reject" | "revoke") {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const payload = action === "approve" ? { action, requestId: row.id, challenge: challenge.trim(), proofMethod: method, proofNote: note.trim(), confirmedControl: confirmed }
        : action === "reject" ? { action, requestId: row.id, reason: reason.trim() }
          : { action, bindingId: row.binding?.id, reason: reason.trim() };
      await bindingJson("/api/admin/platform-bindings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      onDone();
    } catch (err) { setError(err instanceof Error ? err.message : "处理失败"); }
    finally { setBusy(false); }
  }
  const uid = <code>{row.authorUid}</code>;
  const workUrl = canonicalVideoUrl(row.platform === "douyin" ? "douyin-long-link" : "long-link", row.photoId);
  return <article className={styles.card}>
    <h2>{row.user.nickname} · {platformLabel(row.platform)}</h2>
    <p>成员 ID：<code>{row.user.kuaishouId}</code></p><p>平台作者 UID：{uid}</p>
    <p>参考作品：<code>{row.photoId}</code> · {bindingRequestStatus(row.status)}</p>
    {workUrl && <p><a href={workUrl} target="_blank" rel="noopener noreferrer">打开参考作品</a></p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {row.status === "PENDING" ? <>
      <p className={styles.muted}>有效期至 {bindingDate(row.expiresAt)}{expired ? "（已过期）" : ""}；请核对实际平台账号与上述 UID 一致。</p>
      {(self || !row.user.active) && <p className={styles.error}>{self ? "不能核验自己的账号。" : "成员已停用，不能通过核验。"}</p>}
      <details><summary>核验此申请</summary>
        <label>核验方式<select value={method} disabled={busy} onChange={(event) => setMethod(event.target.value)}><option value="PLATFORM_MESSAGE">平台账号发来的私信</option><option value="PROFILE_CHALLENGE">实际账号简介中的挑战码</option></select></label>
        <label>从平台账号实际取得的完整挑战码<input value={challenge} maxLength={100} disabled={busy} autoComplete="off" onChange={(event) => setChallenge(event.target.value)} /></label>
        <label>核验证据说明<textarea value={note} maxLength={1000} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="记录核验时间、UID 核对方式及收到挑战码的渠道（至少 20 字）；不要粘贴密码、手机号或私密对话。" /></label>
        <label className={styles.check}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已在实际平台确认 UID 为 {uid} 的账号展示或发送了本次挑战码，不能仅凭同名主页或截图通过。</span></label>
        <button disabled={busy || expired || self || !row.user.active || !confirmed || !/^MM-[A-Za-z0-9_-]{24}$/.test(challenge.trim()) || note.trim().length < 20} onClick={() => void act("approve")}>{busy ? "处理中…" : "确认账号控制权并绑定"}</button>
        <label>驳回原因<textarea value={reason} maxLength={1000} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="至少 4 字，说明需要补充或重新核验的内容" /></label>
        <button className={styles.secondary} disabled={busy || self || reason.trim().length < 4} onClick={() => void act("reject")}>驳回申请</button>
      </details>
    </> : <>
      {row.proofNote && <p>核验记录：{row.proofNote}</p>}
      {row.rejectionReason && <p>处理原因：{row.rejectionReason}</p>}
      {row.binding && !row.binding.revokedAt && <details><summary>撤销此账号绑定</summary><p>停止该账号后续视频入账，保留历史积分和 UID 归属记录。</p><label>撤销原因<textarea value={reason} maxLength={1000} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label><button className={styles.secondary} disabled={busy || reason.trim().length < 4} onClick={() => void act("revoke")}>{busy ? "处理中…" : "确认撤销绑定"}</button></details>}
      {row.binding?.revokedAt && <p>绑定已撤销：{bindingDate(row.binding.revokedAt)}</p>}
    </>}
  </article>;
}

export default function BindingAdminPage({ actorId }: { actorId: string }) {
  const [status, setStatus] = useState("PENDING");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    void bindingJson<ReviewData>(`/api/admin/platform-bindings?status=${status}&page=${page}`, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setData({ requests: result.requests ?? [], pagination: result.pagination ?? { page: 1, pages: 1, total: 0 } });
    }).catch((err) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [status, page, revision]);
  function done() { setMessage("处理完成，验证状态已更新。"); setRevision((value) => value + 1); }
  return <main className={styles.page}>
    <Link href="/admin">返回管理后台</Link><h1>账号归属核验</h1>
    <p className={styles.notice}>这里只处理平台账号控制权。普通视频继续自动审核；昵称、公开主页和他人截图均不能单独证明账号归属。</p>
    <div className={styles.toolbar}><label>申请状态<select value={status} disabled={loading} onChange={(event) => { setStatus(event.target.value); setPage(1); setMessage(""); }}><option value="PENDING">待核验</option><option value="APPROVED">已通过</option><option value="REJECTED">未通过</option></select></label><button className={styles.secondary} disabled={loading} onClick={() => setRevision((value) => value + 1)}>{loading ? "加载中…" : "刷新列表"}</button></div>
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.success} role="status">{message}</p>}
    {loading && <p role="status">正在加载验证申请…</p>}
    {data && <>{!data.requests.length && <p className={styles.card}>当前没有此状态的验证申请。</p>}{data.requests.map((row) => <ReviewCard key={row.id} row={row} actorId={actorId} onDone={done} />)}<nav className={styles.pagination} aria-label="验证申请分页"><button className={styles.secondary} disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>第 {page} 页 · 共 {data.pagination.total} 项</span><button className={styles.secondary} disabled={loading || page >= data.pagination.pages} onClick={() => setPage((value) => value + 1)}>下一页</button></nav></>}
  </main>;
}

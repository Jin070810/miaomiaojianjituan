"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { bindingDate, bindingJson, bindingRequestStatus, platformLabel } from "./client-api";
import styles from "./bindings.module.css";

type BindingData = {
  bindings: Array<{ id: string; platform: string; authorUid: string; revokedAt: string | null }>;
  requests: Array<{ id: string; platform: string; authorUid: string; challenge: string; status: string; expiresAt: string; rejectionReason: string | null }>;
  videos: Array<{ id: string; sourceKind: string; photoId: string; fetchedAuthorUid: string; fetchedOwner: string | null }>;
};

export default function BindingMemberPage() {
  const [data, setData] = useState<BindingData | null>(null);
  const [videoId, setVideoId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void bindingJson<BindingData>("/api/platform-bindings", { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setData({ bindings: result.bindings ?? [], requests: result.requests ?? [], videos: result.videos ?? [] });
    }).catch((err) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  async function submit() {
    if (!videoId || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await bindingJson("/api/platform-bindings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId }) });
      setMessage("验证挑战已生成，请使用作品的作者账号完成下一步。");
      refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "申请失败"); }
    finally { setBusy(false); }
  }

  async function copyCode(code: string) {
    try { await navigator.clipboard.writeText(code); setMessage("挑战码已复制"); }
    catch { setError("复制失败，请手动选中并复制完整挑战码"); }
  }

  return <main className={styles.page}>
    <Link href="/">返回成员首页</Link>
    <h1>平台账号验证</h1>
    <p>首次用快手或抖音作品领取积分前，需要证明您能控制作品的作者账号。昵称修改后无需重新绑定。</p>
    <div className={styles.notice}>
      <p>先提交一条自己的公开视频，等待系统取得作者信息。选择下方作品生成挑战码，再使用同一个平台账号把挑战码发给团管理员，或临时放入该账号的简介，等待管理员核验。</p>
      <p className={styles.muted}>请勿发送密码、手机号或私密聊天截图。这里只验证账号归属，普通视频仍由系统自动审核。</p>
    </div>
    <div className={styles.toolbar}><button className={styles.secondary} disabled={loading || busy} onClick={refresh}>{loading ? "加载中…" : "刷新验证状态"}</button></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.success} role="status">{message}</p>}
    {loading && !data && <p role="status">正在加载账号与作品…</p>}
    {data && <>
      <section className={styles.card} aria-labelledby="bindings-title"><h2 id="bindings-title">已验证账号</h2>
        {data.bindings.length ? data.bindings.map((binding) => <p key={binding.id}>{platformLabel(binding.platform)} · <code>{binding.authorUid}</code> · {binding.revokedAt ? "已撤销，请重新验证" : "已验证"}</p>) : <p className={styles.muted}>尚未绑定平台账号。</p>}
      </section>
      <section className={styles.card} aria-labelledby="request-title"><h2 id="request-title">发起账号验证</h2>
        {!data.videos.length && <p className={styles.muted}>暂无可验证的作品。请先提交自己的公开视频；若系统没有取得作者 UID，请联系管理员重新抓取。</p>}
        <label>选择自己的作品<select value={videoId} disabled={busy || loading || !data.videos.length} onChange={(event) => setVideoId(event.target.value)}>
          <option value="">请选择作品</option>{data.videos.map((video) => <option key={video.id} value={video.id}>{platformLabel(video.sourceKind.startsWith("douyin-") ? "douyin" : "kuaishou")} · {video.fetchedOwner ?? "作者"} · 作品 {video.photoId}</option>)}
        </select></label>
        <button disabled={busy || loading || !data.videos.some((video) => video.id === videoId)} onClick={() => void submit()}>{busy ? "正在生成…" : "生成验证挑战"}</button>
      </section>
      <section aria-labelledby="requests-title"><h2 id="requests-title">验证申请</h2>
        {!data.requests.length && <p className={styles.muted}>暂无验证申请。</p>}
        {data.requests.map((request) => <article className={styles.card} key={request.id}>
          <h3>{platformLabel(request.platform)} · {bindingRequestStatus(request.status)}</h3>
          <p>作者 UID：<code>{request.authorUid}</code></p>
          {request.status === "PENDING" && <><p>挑战码有效期至 {bindingDate(request.expiresAt)}。请使用该 UID 对应的平台账号完成验证，其他账号发来的挑战码无效。</p><code className={styles.code}>{request.challenge}</code><button className={styles.secondary} onClick={() => void copyCode(request.challenge)}>复制挑战码</button></>}
          {request.status === "APPROVED" && <p>核验已通过。此前未通过的视频可提交申诉，或联系管理员重新抓取；不会自动补发历史积分。</p>}
          {request.rejectionReason && <p>{request.rejectionReason}</p>}
        </article>)}
      </section>
    </>}
  </main>;
}

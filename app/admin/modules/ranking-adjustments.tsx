"use client";

import { useEffect, useState } from "react";
import { useAdminActionDialog } from "./admin-action-dialog";
import type { RankingAdjustmentResolution } from "@/lib/ranking-adjustments";

type Adjustment = {
  id: string; videoId: string; kind: "FREEZE_UNPAID" | "REVIEW_PAID"; status: "PENDING" | "RESOLVED";
  source: "SNAPSHOT" | "LEGACY_WINDOW"; reason: string; createdAt: string;
  resolution: RankingAdjustmentResolution | null; resolutionNote: string | null;
  award: { id: string; rank: number; value: number; status: string; rewardTitle: string | null; user: { nickname: string; kuaishouId: string }; period: { type: "WEEK" | "MONTH"; periodStart: string; periodEnd: string } };
};
type Result = { tasks: Adjustment[]; pagination: { page: number; pages: number; total: number }; counts: { pending: number; unpaid: number; paid: number } };
const resolutionLabels: Record<RankingAdjustmentResolution, string> = { RELEASE: "解除本项冻结", CANCEL: "取消该奖励", ADJUSTED: "记录调整完成", NO_CHANGE: "确认无需调整" };
const resolvedLabels: Record<RankingAdjustmentResolution, string> = { RELEASE: "本项已解冻", CANCEL: "奖励已取消", ADJUSTED: "已记录调整", NO_CHANGE: "无需调整" };
const date = (value: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium" }).format(new Date(value));

export function RankingAdjustments({ onChanged }: { onChanged: () => Promise<void> }) {
  const [status, setStatus] = useState<"PENDING" | "RESOLVED">("PENDING");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  const { ask, dialog } = useAdminActionDialog();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch(`/api/admin/rankings/adjustments?status=${status}&page=${page}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "榜单调整待办加载失败"); if (!controller.signal.aborted) { setData(result); if (page > Math.max(1, result.pagination.pages)) setPage(Math.max(1, result.pagination.pages)); } })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "榜单调整待办加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [status, page, revision]);

  async function resolve(task: Adjustment, resolution: RankingAdjustmentResolution) {
    if (processing) return;
    const note = await ask({ title: resolutionLabels[resolution], label: "处理依据（5 至 1000 字）", multiline: true, required: true,
      description: resolution === "CANCEL" ? "取消此奖励会关闭其全部未发奖励冻结待办，并恢复已预留库存一次。" : resolution === "RELEASE" ? "仅解除本项冻结；仍有其他待核实项时，奖励继续冻结。" : "请先完成实际核实或线下调整，再记录结果。本操作保留已发记录，不自动扣积分。",
      impact: [{ label: "成员", value: `${task.award.user.nickname} · ${task.award.user.kuaishouId}` }, { label: "奖励", value: task.award.rewardTitle ?? "榜单奖励" }, { label: "历史榜单", value: `第 ${task.award.rank} 名，成绩 ${task.award.value}，保持不变` }, { label: "证据", value: task.source === "SNAPSHOT" ? "撤销视频在结算贡献快照内" : "旧周期缺少贡献明细，需先核实相关性", tone: "warning" }],
      confirmLabel: "保存处理结果", tone: resolution === "CANCEL" ? "danger" : "default" });
    if (note === null) return;
    if (note.trim().length < 5 || note.trim().length > 1000) { setError("处理依据需填写 5 至 1000 字"); return; }
    setProcessing(task.id); setError(""); setFeedback("");
    try {
      const response = await fetch(`/api/admin/rankings/adjustments/${task.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ resolution, note }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "处理结果保存失败");
      setFeedback("处理结果已保存，历史榜单保持不变。");
      setRevision((value) => value + 1);
      try { await onChanged(); } catch { setError("处理结果已保存，但奖励列表刷新失败，请重新打开榜单页核对。"); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "处理结果保存失败"); }
    finally { setProcessing(null); }
  }

  return <section className="admin-panel ranking-adjustment-panel" aria-labelledby="ranking-adjustment-heading">
    <div className="admin-panel-head"><div><h2 id="ranking-adjustment-heading">撤销关联奖励待办</h2><p>历史名次保留；未发奖励先冻结，已发奖励逐项核实。</p></div><button className="secondary-button" disabled={loading || Boolean(processing)} onClick={() => setRevision((value) => value + 1)}>刷新待办</button></div>
    <div className="ranking-adjustment-toolbar"><button className={status === "PENDING" ? "primary-button" : "secondary-button"} disabled={Boolean(processing)} onClick={() => { setStatus("PENDING"); setPage(1); }}>待处理{data ? ` ${data.counts.pending}` : ""}</button><button className={status === "RESOLVED" ? "primary-button" : "secondary-button"} disabled={Boolean(processing)} onClick={() => { setStatus("RESOLVED"); setPage(1); }}>已处理</button>{data && <span>未发冻结 {data.counts.unpaid} 项 · 已发核实 {data.counts.paid} 项</span>}</div>
    {feedback && <p role="status">{feedback}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <p className="empty-copy" role="status">正在读取榜单调整待办…</p> : !error && data && <>
      <div className="ranking-adjustment-list">{data.tasks.map((task) => <article className="ranking-adjustment-card" key={task.id} aria-label={`${task.award.user.nickname}的榜单调整`}>
        <div className="ranking-adjustment-title"><strong>{task.award.user.nickname} · {task.award.period.type === "WEEK" ? "周榜" : "月榜"}第 {task.award.rank} 名</strong><span className={`status-chip ${task.status === "RESOLVED" ? "success" : "warning"}`}>{task.status === "RESOLVED" && task.resolution ? resolvedLabels[task.resolution] : task.kind === "FREEZE_UNPAID" ? "未发奖励冻结" : "已发奖励核实"}</span></div>
        <p>{date(task.award.period.periodStart)} 至 {date(task.award.period.periodEnd)} · {task.award.rewardTitle ?? "榜单奖励"}</p><p>撤销原因：{task.reason}</p><small>视频记录：{task.videoId} · {task.source === "SNAPSHOT" ? "已核对结算贡献快照" : "旧周期缺少贡献明细，相关性待核实"}</small>
        {task.status === "PENDING" ? <div className="ranking-adjustment-actions">{(task.kind === "FREEZE_UNPAID" ? ["RELEASE", "CANCEL"] as const : ["ADJUSTED", "NO_CHANGE"] as const).map((resolution) => <button key={resolution} className="secondary-button" disabled={Boolean(processing)} onClick={() => void resolve(task, resolution)}>{processing === task.id ? "处理中…" : resolutionLabels[resolution]}</button>)}</div> : <p><b>{task.resolution ? resolutionLabels[task.resolution] : "已处理"}</b>：{task.resolutionNote}</p>}
      </article>)}</div>
      {data.tasks.length === 0 && <p className="empty-copy">{status === "PENDING" ? "暂无待处理的榜单奖励调整" : "暂无已处理记录"}</p>}
      {data.pagination.pages > 1 && <div className="ranking-adjustment-toolbar"><button className="secondary-button" disabled={page <= 1 || Boolean(processing)} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page} / {data.pagination.pages}</span><button className="secondary-button" disabled={page >= data.pagination.pages || Boolean(processing)} onClick={() => setPage((value) => value + 1)}>下一页</button></div>}
    </>}{dialog}
  </section>;
}

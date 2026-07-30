"use client";

import { Activity, X } from "lucide-react";
import { useEffect, useState } from "react";

type ActivityRow = { id: string; actionLabel: string; summary: string; createdAt: string; reason: string | null };

export function ActivityDrawer({ entity, entityId, title, onClose }: { entity: string; entityId: string; title: string; onClose: () => void }) {
  const [rows, setRows] = useState<ActivityRow[]>([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  useEffect(() => { const controller = new AbortController(); void (async () => { try { const response = await fetch(`/api/admin/activity?entity=${encodeURIComponent(entity)}&entityId=${encodeURIComponent(entityId)}`, { cache: "no-store", signal: controller.signal }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "动态加载失败"); setRows(result.activity ?? []); } catch (loadError) { if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "动态加载失败"); } finally { if (!controller.signal.aborted) setLoading(false); } })(); return () => controller.abort(); }, [entity, entityId]);
  return <div className="admin-drawer-backdrop" role="presentation" onMouseDown={onClose}><aside className="admin-activity-drawer" role="dialog" aria-modal="true" aria-label={`${title}操作动态`} onMouseDown={(event) => event.stopPropagation()}><header><div><span className="eyebrow">AUDIT ACTIVITY</span><h2>{title}</h2></div><button className="icon-button" aria-label="关闭动态" onClick={onClose}><X size={18} /></button></header>{loading ? <p className="field-hint"><Activity size={16} /> 正在加载操作动态...</p> : error ? <p className="form-error">{error}</p> : rows.length ? <ol className="admin-activity-list">{rows.map((row) => <li key={row.id}><strong>{row.actionLabel}</strong><span>{row.summary}</span>{row.reason && <small>原因：{row.reason}</small>}<time>{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(row.createdAt))}</time></li>)}</ol> : <p className="field-hint">暂无可展示的审计动态</p>}</aside></div>;
}

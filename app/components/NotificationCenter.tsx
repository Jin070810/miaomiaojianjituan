"use client";

import {
  Bell,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Gift,
  Megaphone,
  PackageCheck,
  Trophy,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  metadata?: Record<string, unknown> | null;
  readAt: string | null;
  withdrawn?: boolean;
  createdAt: string;
};

type NotificationResponse = {
  notifications: NotificationRow[];
  unreadCount: number;
  pagination: { page: number; take: number; total: number; pages: number };
};

type NotificationCenterProps = {
  onOpenDetail?: (row: NotificationRow) => void;
};

const PROMPT_SESSION_KEY = "miaomiao-notification-prompt-shown";

export function clearNotificationPromptSession() {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(PROMPT_SESSION_KEY);
}

function notificationIcon(type: string) {
  if (type === "ANNOUNCEMENT") return Megaphone;
  if (type === "POINT_CHANGE") return CircleDollarSign;
  if (type === "REDEMPTION") return Gift;
  if (type === "SHIPMENT") return PackageCheck;
  if (type === "RANKING_RESULT" || type === "RANKING_AWARD") return Trophy;
  if (type === "VIDEO_RESULT" || type === "VIDEO_REVIEW") return Video;
  return FileText;
}

function notificationTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default function NotificationCenter({ onOpenDetail }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<NotificationResponse | null>(null);
  const [popupRows, setPopupRows] = useState<NotificationRow[]>([]);
  const [popupOpen, setPopupOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (nextPage = page, nextFilter = filter, showPrompt = false) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/notifications?status=${nextFilter}&page=${nextPage}&take=20`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "通知加载失败");
      const parsed = result as NotificationResponse;
      setData(parsed);
      setError("");
      if (showPrompt && parsed.unreadCount > 0 && !window.sessionStorage.getItem(PROMPT_SESSION_KEY)) {
        const unreadResponse = await fetch("/api/notifications?status=unread&page=1&take=10", { cache: "no-store" });
        const unreadResult = await unreadResponse.json();
        if (unreadResponse.ok && unreadResult.notifications?.length) {
          setPopupRows(unreadResult.notifications.slice(0, 10));
          setPopupOpen(true);
          window.sessionStorage.setItem(PROMPT_SESSION_KEY, "1");
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "通知加载失败");
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    void load(1, "unread", true);
    const refresh = () => void load(page, filter, false);
    const timer = window.setInterval(refresh, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, [load, page, filter]);

  const unreadCount = data?.unreadCount ?? 0;

  async function markRead(id: string) {
    const response = await fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
    if (!response.ok) return;
    setData((current) => current ? {
      ...current,
      unreadCount: Math.max(0, current.unreadCount - (current.notifications.find((row) => row.id === id)?.readAt ? 0 : 1)),
      notifications: current.notifications.map((row) => row.id === id ? { ...row, readAt: new Date().toISOString() } : row),
    } : current);
    setPopupRows((rows) => rows.map((row) => row.id === id ? { ...row, readAt: new Date().toISOString() } : row));
  }

  async function markAllRead() {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "read-all" }),
    });
    if (!response.ok) return;
    setData((current) => current ? {
      ...current,
      unreadCount: 0,
      notifications: current.notifications.map((row) => ({ ...row, readAt: row.readAt ?? new Date().toISOString() })),
    } : current);
    setPopupRows((rows) => rows.map((row) => ({ ...row, readAt: row.readAt ?? new Date().toISOString() })));
  }

  function changeFilter(next: "all" | "unread") {
    setFilter(next);
    setPage(1);
    void load(1, next, false);
  }

  const rows = useMemo(() => data?.notifications ?? [], [data]);
  const renderRow = (row: NotificationRow, compact = false) => {
    const Icon = notificationIcon(row.type);
    return (
      <button
        key={row.id}
        className={`notification-row ${row.readAt ? "" : "unread"}`}
        onClick={() => { void markRead(row.id); onOpenDetail?.(row); if (compact) setPopupOpen(false); }}
      >
        <span className="notification-icon"><Icon size={17} /></span>
        <span className="notification-copy">
          <strong>{row.title}</strong>
          <span className={compact ? "notification-summary" : "notification-body"}>{row.body}</span>
          {row.entityId && <span className="notification-detail-link">查看详情</span>}
          <small>{notificationTime(row.createdAt)}{row.withdrawn ? " · 已撤回" : ""}</small>
        </span>
        {!row.readAt && <i className="notification-unread-dot" />}
      </button>
    );
  };

  return (
    <>
      <button className="icon-button notification-trigger" aria-label={`通知${unreadCount ? `，${unreadCount}条未读` : ""}`} onClick={() => { setOpen(true); void load(page, filter, false); }}>
        <Bell size={19} />
        {unreadCount > 0 && <b>{unreadCount > 99 ? "99+" : unreadCount}</b>}
      </button>
      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="notification-panel" role="dialog" aria-modal="true" aria-labelledby="notification-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="notification-panel-head">
              <div><span className="eyebrow">MESSAGE CENTER</span><h2 id="notification-title">通知中心</h2></div>
              <button className="icon-button" aria-label="关闭通知中心" onClick={() => setOpen(false)}><X size={19} /></button>
            </header>
            <div className="notification-toolbar">
              <div className="notification-tabs">
                <button className={filter === "all" ? "active" : ""} onClick={() => changeFilter("all")}>全部</button>
                <button className={filter === "unread" ? "active" : ""} onClick={() => changeFilter("unread")}>未读{unreadCount ? ` ${unreadCount}` : ""}</button>
              </div>
              <button className="text-button" onClick={() => void markAllRead()} disabled={!unreadCount}><CheckCheck size={15} />全部已读</button>
            </div>
            {loading && <div className="notification-loading">正在加载通知...</div>}
            {error && <div className="notification-error" role="alert">{error}<button className="secondary-button compact-button" onClick={() => void load()}>重试</button></div>}
            {!loading && !error && rows.length === 0 && <div className="empty-state notification-empty"><Bell size={25} /><strong>暂无通知</strong><span>{filter === "unread" ? "所有通知都已读" : "新的进度和公告会显示在这里"}</span></div>}
            {!loading && !error && rows.length > 0 && <div className="notification-list">{rows.map((row) => renderRow(row))}</div>}
            {data && data.pagination.pages > 1 && (
              <footer className="notification-pagination">
                <button className="icon-button" disabled={page <= 1} aria-label="上一页" onClick={() => { const next = page - 1; setPage(next); void load(next, filter, false); }}><ChevronLeft size={17} /></button>
                <span>{page} / {data.pagination.pages}</span>
                <button className="icon-button" disabled={page >= data.pagination.pages} aria-label="下一页" onClick={() => { const next = page + 1; setPage(next); void load(next, filter, false); }}><ChevronRight size={17} /></button>
              </footer>
            )}
          </section>
        </div>
      )}
      {popupOpen && (
        <div className="modal-backdrop notification-popup-backdrop" role="presentation" onMouseDown={() => setPopupOpen(false)}>
          <section className="notification-popup" role="dialog" aria-modal="true" aria-labelledby="notification-popup-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="notification-panel-head">
              <div><span className="eyebrow">NEW UPDATES</span><h2 id="notification-popup-title">你有新的通知</h2></div>
              <button className="icon-button" aria-label="关闭未读通知提醒" onClick={() => setPopupOpen(false)}><X size={19} /></button>
            </header>
            <p className="notification-popup-hint">打开通知详情后会标记为已读，关闭提醒不会影响未读状态。</p>
            <div className="notification-list">{popupRows.map((row) => renderRow(row, true))}</div>
            <button className="primary-button full-button" onClick={() => { setPopupOpen(false); setOpen(true); void load(1, "unread", false); }}>查看全部未读</button>
          </section>
        </div>
      )}
    </>
  );
}

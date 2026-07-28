"use client";

import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Gift,
  Package,
  Receipt,
  Trophy,
  UsersThree,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { StateMessage } from "./brand";
import { miaoAssets } from "./visual-assets";

type RecordData = {
  user: { id: string; balance: number };
  ledger: Array<{ id: string; type: string; amount: number; note: string | null; createdAt: string }>;
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
  orders: Array<{
    id: string;
    status: string;
    totalCost: number;
    createdAt: string;
    trackingNumber: string | null;
    gift: { name: string; kind: "PHYSICAL" | "CASH" | "MEMBERSHIP" };
  }>;
};

type RecordViewProps = {
  onBack: () => void;
  data: RecordData;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function ledgerLabel(type: string, note: string | null) {
  if (note) return note;
  const labels: Record<string, string> = {
    VIDEO_REWARD: "切片通过",
    TRANSFER_IN: "收到团友积分",
    TRANSFER_OUT: "送积分给团友",
    REDEMPTION: "兑换礼物",
    ADMIN_ADJUSTMENT: "积分调整",
    REVERSAL: "积分退回",
    REFUND: "兑换退款",
    RANKING_REWARD: "榜单奖励",
  };
  return labels[type] ?? "积分变动";
}

function LoadMoreHistory({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <button className="journal-outline-button load-more-button" onClick={onClick} disabled={loading}>
      {loading ? "正在加载..." : "加载更多记录"}
    </button>
  );
}

function RecordHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="record-header">
      <button aria-label="返回" onClick={onBack}><ArrowLeft size={28} /></button>
      <h1>{title}</h1>
      <span aria-hidden="true" />
    </header>
  );
}

function recordIcon(type: string, positive: boolean) {
  if (type.includes("TRANSFER")) return positive ? <ArrowDownLeft size={24} /> : <ArrowUpRight size={24} />;
  if (type.includes("RANK")) return <Trophy size={24} />;
  if (type.includes("REDEMPTION")) return <Gift size={24} />;
  return <Receipt size={24} />;
}

export function LedgerView({ onBack, data, hasMore, loadingMore, onLoadMore }: RecordViewProps) {
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const rows = useMemo(
    () => data.ledger.filter((item) => filter === "all" || (filter === "income" ? item.amount > 0 : item.amount < 0)),
    [data.ledger, filter],
  );
  return (
    <div className="member-content journal-record-page">
      <RecordHeader title="积分记录" onBack={onBack} />
      <section className="record-summary">
        <span>当前积分</span>
        <strong>{data.user.balance.toLocaleString()}</strong>
      </section>
      <div className="journal-tabs record-tabs">
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部</button>
        <button className={filter === "income" ? "active" : ""} onClick={() => setFilter("income")}>获得</button>
        <button className={filter === "expense" ? "active" : ""} onClick={() => setFilter("expense")}>使用</button>
      </div>
      <section className="record-group">
        <div className="journal-section-heading ruled"><h2>最近</h2></div>
        <div className="record-timeline">
          {rows.map((item) => (
            <article className="record-row" key={item.id}>
              <span className="record-icon">{recordIcon(item.type, item.amount >= 0)}</span>
              <div className="record-copy">
                <strong>{ledgerLabel(item.type, item.note)}</strong>
                <span>{formatDate(item.createdAt)}</span>
              </div>
              <b className={item.amount >= 0 ? "positive-text" : ""}>{item.amount >= 0 ? "+" : ""}{item.amount.toLocaleString()}</b>
            </article>
          ))}
          {rows.length === 0 && <StateMessage {...miaoAssets.states.first}>这里暂时没有记录</StateMessage>}
        </div>
      </section>
      <LoadMoreHistory hasMore={hasMore} loading={loadingMore} onClick={onLoadMore} />
    </div>
  );
}

export function TransferRecordsView({ onBack, data, hasMore, loadingMore, onLoadMore }: RecordViewProps) {
  const [filter, setFilter] = useState<"all" | "out" | "in">("all");
  const rows = data.transfers.filter((transfer) => filter === "all" || (filter === "out" ? transfer.senderId === data.user.id : transfer.receiverId === data.user.id));
  const sent = data.transfers.filter((item) => item.senderId === data.user.id);
  const sentPoints = sent.reduce((total, item) => total + item.amount, 0);
  return (
    <div className="member-content journal-record-page">
      <RecordHeader title="送积分记录" onBack={onBack} />
      <p className="record-inline-summary">本月送出 <b>{sentPoints.toLocaleString()}</b> 积分 · <b>{sent.length}</b> 位团友</p>
      <div className="journal-tabs record-tabs">
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部</button>
        <button className={filter === "out" ? "active" : ""} onClick={() => setFilter("out")}>我送出的</button>
        <button className={filter === "in" ? "active" : ""} onClick={() => setFilter("in")}>我收到的</button>
      </div>
      <section className="record-group">
        <div className="journal-section-heading ruled"><h2>最近</h2></div>
        <div className="record-timeline">
          {rows.map((transfer) => {
            const outgoing = transfer.senderId === data.user.id;
            const counterparty = outgoing ? transfer.receiver : transfer.sender;
            return (
              <article className="record-row transfer-record-row" key={transfer.id}>
                <span className="record-icon">{outgoing ? <ArrowUpRight size={24} /> : <ArrowDownLeft size={24} />}</span>
                <span className="record-avatar"><UsersThree size={24} /></span>
                <div className="record-copy">
                  <strong>{outgoing ? "送给" : "收到"} {counterparty.nickname}</strong>
                  <span title={counterparty.kuaishouId}>ID · {counterparty.kuaishouId}</span>
                  {transfer.note && <small>{transfer.note}</small>}
                </div>
                <div className="record-side">
                  <b className={outgoing ? "" : "positive-text"}>{outgoing ? "-" : "+"}{transfer.amount.toLocaleString()}</b>
                  <span>{formatDate(transfer.createdAt)}</span>
                </div>
              </article>
            );
          })}
          {rows.length === 0 && <StateMessage {...miaoAssets.actions.gift}>这里暂时没有送积分记录</StateMessage>}
        </div>
      </section>
      <LoadMoreHistory hasMore={hasMore} loading={loadingMore} onClick={onLoadMore} />
    </div>
  );
}

function orderStatusLabel(status: string, kind: "PHYSICAL" | "CASH" | "MEMBERSHIP") {
  const labels: Record<string, string> = {
    PENDING: "待发放",
    APPROVED: kind === "PHYSICAL" ? "待发放" : kind === "MEMBERSHIP" ? "待开通" : "正在准备",
    FULFILLED: kind === "PHYSICAL" ? "已发货" : kind === "MEMBERSHIP" ? "已开通" : "已完成",
    REJECTED: "未通过",
    REFUNDED: "积分已退回",
  };
  return labels[status] ?? status;
}

export function RedemptionRecordsView({ onBack, data, hasMore, loadingMore, onLoadMore }: RecordViewProps) {
  const [filter, setFilter] = useState<"all" | "pending" | "done">("all");
  const rows = data.orders.filter((order) => {
    if (filter === "all") return true;
    const done = ["FULFILLED", "REFUNDED", "REJECTED"].includes(order.status);
    return filter === "done" ? done : !done;
  });
  return (
    <div className="member-content journal-record-page">
      <RecordHeader title="兑换记录" onBack={onBack} />
      <p className="record-inline-summary">本月兑换 <b>{data.orders.length}</b> 件</p>
      <div className="journal-tabs record-tabs">
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部</button>
        <button className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}>待发放</button>
        <button className={filter === "done" ? "active" : ""} onClick={() => setFilter("done")}>已完成</button>
      </div>
      <section className="record-group redemption-records">
        <div className="record-timeline">
          {rows.map((order) => (
            <article className="record-row" key={order.id}>
              <span className="record-icon"><Package size={25} /></span>
              <div className="record-copy">
                <strong>{order.gift.name}</strong>
                <b className="record-cost">{order.totalCost.toLocaleString()} 积分</b>
              </div>
              <div className="record-side">
                <b className="plain-status">{orderStatusLabel(order.status, order.gift.kind)}</b>
                {order.trackingNumber && <small title={order.trackingNumber}>查看物流</small>}
                <span>{formatDate(order.createdAt)}</span>
              </div>
            </article>
          ))}
          {rows.length === 0 && <StateMessage {...miaoAssets.states.redeemed}>这里暂时没有兑换记录</StateMessage>}
        </div>
      </section>
      <LoadMoreHistory hasMore={hasMore} loading={loadingMore} onClick={onLoadMore} />
    </div>
  );
}

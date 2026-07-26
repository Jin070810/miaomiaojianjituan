"use client";

import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  Gift,
  PackageCheck,
  Search,
} from "lucide-react";
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
    gift: { name: string; kind: "PHYSICAL" | "CASH" };
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
    VIDEO_REWARD: "切片奖励",
    TRANSFER_IN: "团友送来的积分",
    TRANSFER_OUT: "送给团友的积分",
    REDEMPTION: "礼品兑换",
    ADMIN_ADJUSTMENT: "管理员调整",
    REVERSAL: "积分冲正",
    REFUND: "兑换退款",
  };
  return labels[type] ?? "积分变动";
}

function LoadMoreHistory({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <button className="secondary-button full-button" onClick={onClick} disabled={loading}>
      <ChevronDown size={16} /> {loading ? "加载中..." : "加载更多记录"}
    </button>
  );
}

export function LedgerView({ onBack, data, hasMore, loadingMore, onLoadMore }: RecordViewProps) {
  const income = data.ledger.filter((item) => item.amount > 0).reduce((total, item) => total + item.amount, 0);
  const expense = Math.abs(data.ledger.filter((item) => item.amount < 0).reduce((total, item) => total + item.amount, 0));
  return (
    <div className="member-content">
      <section className="page-header-row">
        <div className="back-title">
          <button className="icon-button" aria-label="返回" onClick={onBack}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <span className="eyebrow">每一分都记在这里</span>
            <h1 className="page-title">积分记录</h1>
          </div>
        </div>
        <button className="icon-button" aria-label="筛选">
          <Search size={20} />
        </button>
      </section>
      <section className="ledger-total">
        <span>当前积分</span>
        <strong>{data.user.balance.toLocaleString()}</strong>
        <div><span>收入 {income.toLocaleString()}</span><span>支出 {expense.toLocaleString()}</span></div>
      </section>
      <div className="ledger-filter">
        <button className="active">全部</button>
        <button>收入</button>
        <button>支出</button>
        <button>近三个月</button>
      </div>
      <section className="ledger-list">
        {data.ledger.map((item) => {
          const Icon = item.amount >= 0 ? ArrowDownLeft : Gift;
          return (
            <div className="ledger-row" key={item.id}>
              <span className={`ledger-icon ${item.amount >= 0 ? "positive" : "negative"}`}>
                <Icon size={18} />
              </span>
              <div>
                <strong>{ledgerLabel(item.type, item.note)}</strong>
                <span>{formatDate(item.createdAt)}</span>
              </div>
              <b className={item.amount >= 0 ? "positive-text" : "negative-text"}>{item.amount >= 0 ? "+" : ""}{item.amount.toLocaleString()}</b>
            </div>
          );
        })}
        {data.ledger.length === 0 && <StateMessage {...miaoAssets.states.first}>还没有积分记录</StateMessage>}
      </section>
      <LoadMoreHistory hasMore={hasMore} loading={loadingMore} onClick={onLoadMore} />
    </div>
  );
}

export function TransferRecordsView({ onBack, data, hasMore, loadingMore, onLoadMore }: RecordViewProps) {
  return (
    <div className="member-content">
      <section className="page-header-row">
        <div className="back-title">
          <button className="icon-button" aria-label="返回" onClick={onBack}><ArrowLeft size={20} /></button>
          <div><span className="eyebrow">你和团友之间的积分</span><h1 className="page-title">送积分记录</h1></div>
        </div>
      </section>
      <section className="ledger-list">
        {data.transfers.map((transfer) => {
          const outgoing = transfer.senderId === data.user.id;
          const counterparty = outgoing ? transfer.receiver : transfer.sender;
          return (
            <div className="ledger-row" key={transfer.id}>
              <span className={`ledger-icon ${outgoing ? "negative" : "positive"}`}>{outgoing ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}</span>
              <div>
                <strong>{outgoing ? "转给" : "收到"} {counterparty.nickname}</strong>
                <span>{counterparty.kuaishouId} · {formatDate(transfer.createdAt)}{transfer.note ? ` · ${transfer.note}` : ""}</span>
              </div>
              <b className={outgoing ? "negative-text" : "positive-text"}>{outgoing ? "-" : "+"}{transfer.amount.toLocaleString()}</b>
            </div>
          );
        })}
        {data.transfers.length === 0 && <StateMessage {...miaoAssets.actions.gift}>还没有送过积分</StateMessage>}
      </section>
      <LoadMoreHistory hasMore={hasMore} loading={loadingMore} onClick={onLoadMore} />
    </div>
  );
}

function orderStatusLabel(status: string, kind: "PHYSICAL" | "CASH") {
  const labels: Record<string, string> = {
    PENDING: "正在准备",
    APPROVED: kind === "PHYSICAL" ? "正在准备礼物" : "正在准备",
    FULFILLED: kind === "PHYSICAL" ? "已经发出" : "已经送到",
    REJECTED: "这次没换成功",
    REFUNDED: "积分已经退回",
  };
  return labels[status] ?? status;
}

export function RedemptionRecordsView({ onBack, data, hasMore, loadingMore, onLoadMore }: RecordViewProps) {
  return (
    <div className="member-content">
      <section className="page-header-row">
        <div className="back-title">
          <button className="icon-button" aria-label="返回" onClick={onBack}><ArrowLeft size={20} /></button>
          <div><span className="eyebrow">你换过的礼物</span><h1 className="page-title">兑换记录</h1></div>
        </div>
      </section>
      <section className="ledger-list">
        {data.orders.map((order) => (
          <div className="ledger-row" key={order.id}>
            <span className="ledger-icon negative"><PackageCheck size={18} /></span>
            <div>
              <strong>{order.gift.name}</strong>
              <span>{order.gift.kind === "CASH" ? "现金兑换" : "实物商品"} · {formatDate(order.createdAt)}</span>
            </div>
            <div className="record-side"><b className="negative-text">-{order.totalCost.toLocaleString()}</b><span className="status-chip">{orderStatusLabel(order.status, order.gift.kind)}</span>{order.gift.kind === "PHYSICAL" && order.trackingNumber && <small className="tracking-copy">快递单号：{order.trackingNumber}</small>}</div>
          </div>
        ))}
        {data.orders.length === 0 && <StateMessage {...miaoAssets.states.redeemed}>还没有兑换记录</StateMessage>}
      </section>
      <LoadMoreHistory hasMore={hasMore} loading={loadingMore} onClick={onLoadMore} />
    </div>
  );
}

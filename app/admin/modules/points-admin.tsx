"use client";

import { Check, ChevronDown, CircleDollarSign, Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

type AdminUserRow = {
  id: string;
  kuaishouId: string;
  nickname: string;
  role: string;
  active: boolean;
  account: { balance: number } | null;
};

type AdminPointLedgerRow = {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
  account: { user: { nickname: string; kuaishouId: string } };
};

type VideoPointRule = {
  minimumLikes: number;
  fixedTierMaxLikes: number;
  fixedTierPoints: number;
  likesDivisor: number;
  maximumPoints: number;
  submissionWindowDays: number;
};

type Pagination = { page: number; pages: number; total: number };
type AdjustmentInput = {
  selectionMode: "EXPLICIT" | "ALL_ACTIVE_MEMBERS";
  userIds?: string[];
  amount: number;
  reason: string;
};

function formatAdminDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function PointsAdmin({
  users,
  ledger,
  rule,
  pagination,
  onAdjust,
  onRuleSave,
  onLoadMore,
  membersPagination,
  onLoadMoreMembers,
}: {
  users: AdminUserRow[];
  ledger: AdminPointLedgerRow[];
  rule: VideoPointRule;
  pagination: Pagination;
  onAdjust: (input: AdjustmentInput) => Promise<void>;
  onRuleSave: (input: VideoPointRule) => Promise<void>;
  onLoadMore: () => Promise<void>;
  membersPagination: Pagination;
  onLoadMoreMembers: () => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<AdjustmentInput["selectionMode"]>("EXPLICIT");
  const [memberSearch, setMemberSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [ruleDraft, setRuleDraft] = useState(rule);
  const [saving, setSaving] = useState(false);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const activeMembers = users.filter((user) => user.active && user.role === "MEMBER");
  const filteredMembers = activeMembers.filter((user) => {
    const query = memberSearch.trim().toLowerCase();
    return !query || user.nickname.toLowerCase().includes(query) || user.kuaishouId.toLowerCase().includes(query);
  });
  const numericAmount = Number(amount);

  function prepareAdjustment() {
    if ((selectionMode === "EXPLICIT" && !selectedIds.length) || !Number.isInteger(numericAmount) || numericAmount === 0 || !reason.trim()) {
      setError("请选择至少一名成员，输入非零整数积分，并填写调整原因");
      return;
    }
    setError("");
    setFeedback("");
    setConfirming(true);
  }

  async function submitAdjustment() {
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await onAdjust({ selectionMode, userIds: selectionMode === "EXPLICIT" ? selectedIds : undefined, amount: numericAmount, reason: reason.trim() });
      setSelectedIds([]);
      setSelectionMode("EXPLICIT");
      setAmount("");
      setReason("");
      setConfirming(false);
      setFeedback("积分调整已记录，余额和审计日志已更新。");
    } catch (adjustError) {
      setError(adjustError instanceof Error ? adjustError.message : "积分调整失败");
    } finally {
      setSaving(false);
    }
  }

  async function saveRule() {
    const values = Object.fromEntries(Object.entries(ruleDraft).map(([key, value]) => [key, Number(value)])) as VideoPointRule;
    if (Object.values(values).some((value) => !Number.isInteger(value) || value <= 0) || values.fixedTierMaxLikes < values.minimumLikes || values.maximumPoints < values.fixedTierPoints) {
      setError("积分规则必须全部为正整数，且档位和上限关系正确");
      return;
    }
    setRuleSaving(true);
    setError("");
    setFeedback("");
    try {
      await onRuleSave(values);
      setRuleDraft(values);
      setFeedback("积分规则已保存，仅对之后新抓取的视频生效。");
    } catch (ruleError) {
      setError(ruleError instanceof Error ? ruleError.message : "积分规则保存失败");
    } finally {
      setRuleSaving(false);
    }
  }

  return (
    <>
      <div className="admin-page-title"><div><span className="eyebrow">POINTS CONTROL</span><h1>积分管理</h1><p>所有人工调整必须说明原因，并在事务中生成不可变流水。</p></div></div>
      {(error || feedback) && <p className={error ? "form-error" : "form-success"} role="status">{error || feedback}</p>}
      <div className="admin-dashboard-grid">
        <section className="admin-panel audit-panel">
          <div className="admin-panel-head"><div><h2>人工增减积分</h2><p>扣减不能超过成员当前余额；撤销类补偿由系统专用流程处理。</p></div><CircleDollarSign size={19} color="#149e91" /></div>
          <div className="field admin-panel-form">
            <label htmlFor="points-member-search">成员（{selectionMode === "ALL_ACTIVE_MEMBERS" ? "全部有效普通成员" : `已选 ${selectedIds.length} 人`}）</label>
            <div className="member-picker-toolbar">
              <div className="admin-search"><Search size={15} /><input id="points-member-search" value={memberSearch} disabled={selectionMode === "ALL_ACTIVE_MEMBERS"} onChange={(event) => setMemberSearch(event.target.value)} placeholder="搜索昵称或快手 ID" /></div>
              <button className="text-button" onClick={() => { setSelectionMode("ALL_ACTIVE_MEMBERS"); setSelectedIds([]); }}>全部有效成员</button>
              <button className="text-button" disabled={selectionMode === "ALL_ACTIVE_MEMBERS"} onClick={() => setSelectedIds((current) => [...new Set([...current, ...filteredMembers.map((user) => user.id)])])}>选择当前结果</button>
              <button className="text-button" onClick={() => { setSelectionMode("EXPLICIT"); setSelectedIds([]); }} disabled={selectionMode === "EXPLICIT" && !selectedIds.length}>清空</button>
            </div>
            {selectionMode === "ALL_ACTIVE_MEMBERS" ? <p className="field-hint">提交时由服务端在同一事务内选取全部有效普通成员，不受当前分页影响。</p> : <>
              <div className="points-member-list">{filteredMembers.map((user) => <label className="checkbox-field" key={user.id}><input type="checkbox" checked={selectedIds.includes(user.id)} onChange={() => setSelectedIds((current) => current.includes(user.id) ? current.filter((id) => id !== user.id) : [...current, user.id])} /><span>{user.nickname} · {user.kuaishouId}</span><b>{(user.account?.balance ?? 0).toLocaleString()} 分</b></label>)}{filteredMembers.length === 0 && <span className="field-hint">没有匹配的有效普通成员</span>}</div>
              {membersPagination.page < membersPagination.pages && <button className="secondary-button compact-button" onClick={() => void onLoadMoreMembers()}>加载更多成员 <ChevronDown size={15} /></button>}
            </>}
          </div>
          <div className="field admin-panel-form"><label htmlFor="points-amount">每人积分变动</label><input id="points-amount" type="number" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="正数发放，负数扣除" /></div>
          <div className="field admin-panel-form"><label htmlFor="points-reason">原因</label><textarea id="points-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="例如：活动补发、人工纠错、违规扣分" /></div>
          {confirming && <div className="points-confirmation"><strong>请确认本次批量调整</strong><span>{selectionMode === "ALL_ACTIVE_MEMBERS" ? "全部有效普通成员（最终人数由服务端事务确认）" : `${selectedIds.length} 名成员`}，每人 {numericAmount > 0 ? "+" : ""}{numericAmount.toLocaleString()} 分{selectionMode === "EXPLICIT" ? `，总变动 ${Math.abs(numericAmount * selectedIds.length).toLocaleString()} 分` : ""}</span><span>原因：{reason.trim()}</span><div><button className="secondary-button compact-button" onClick={() => setConfirming(false)}>返回修改</button><button className="primary-button compact-button" disabled={saving} onClick={() => void submitAdjustment()}>{saving ? "提交中..." : "确认调整"}</button></div></div>}
          {!confirming && <div className="admin-panel-actions"><button className="primary-button" disabled={saving} onClick={prepareAdjustment}><CircleDollarSign size={16} />预览批量调整</button></div>}
        </section>
        <section className="admin-panel audit-panel">
          <div className="admin-panel-head"><div><h2>视频积分规则</h2><p>修改会留痕，不会重算历史视频。</p></div><SlidersHorizontal size={19} color="#ff5a3d" /></div>
          <div className="admin-form-grid admin-panel-form">
            <div className="field"><label htmlFor="rule-min-likes">最低点赞量</label><input id="rule-min-likes" type="number" step="1" value={ruleDraft.minimumLikes} onChange={(event) => setRuleDraft({ ...ruleDraft, minimumLikes: Number(event.target.value) })} /></div>
            <div className="field"><label htmlFor="rule-tier-max">固定档上限</label><input id="rule-tier-max" type="number" step="1" value={ruleDraft.fixedTierMaxLikes} onChange={(event) => setRuleDraft({ ...ruleDraft, fixedTierMaxLikes: Number(event.target.value) })} /></div>
            <div className="field"><label htmlFor="rule-tier-points">固定档积分</label><input id="rule-tier-points" type="number" step="1" value={ruleDraft.fixedTierPoints} onChange={(event) => setRuleDraft({ ...ruleDraft, fixedTierPoints: Number(event.target.value) })} /></div>
            <div className="field"><label htmlFor="rule-divisor">点赞除数</label><input id="rule-divisor" type="number" step="1" value={ruleDraft.likesDivisor} onChange={(event) => setRuleDraft({ ...ruleDraft, likesDivisor: Number(event.target.value) })} /></div>
            <div className="field"><label htmlFor="rule-max-points">最高积分</label><input id="rule-max-points" type="number" step="1" value={ruleDraft.maximumPoints} onChange={(event) => setRuleDraft({ ...ruleDraft, maximumPoints: Number(event.target.value) })} /></div>
            <div className="field"><label htmlFor="rule-window">有效天数</label><input id="rule-window" type="number" step="1" value={ruleDraft.submissionWindowDays} onChange={(event) => setRuleDraft({ ...ruleDraft, submissionWindowDays: Number(event.target.value) })} /></div>
          </div>
          <div className="admin-panel-actions"><button className="secondary-button" disabled={ruleSaving} onClick={saveRule}><Check size={16} />{ruleSaving ? "保存中..." : "保存规则"}</button></div>
        </section>
      </div>
      <section className="admin-panel audit-panel">
        <div className="admin-panel-head"><div><h2>积分流水</h2><p>共 {pagination.total} 条，当前显示第 {pagination.page} / {pagination.pages} 页</p></div></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>成员</th><th>类型</th><th>变动</th><th>变动后余额</th><th>说明</th><th>时间</th></tr></thead><tbody>{ledger.map((row) => <tr key={row.id}><td><div className="table-main"><span className="table-avatar">{row.account.user.nickname.slice(0, 1)}</span><div><strong>{row.account.user.nickname}</strong><small>{row.account.user.kuaishouId}</small></div></div></td><td>{row.type}</td><td className={row.amount >= 0 ? "positive-text" : "negative-text"}>{row.amount >= 0 ? "+" : ""}{row.amount.toLocaleString()}</td><td>{row.balanceAfter.toLocaleString()}</td><td>{row.note ?? "—"}</td><td>{formatAdminDate(row.createdAt)}</td></tr>)}{ledger.length === 0 && <tr><td colSpan={6}>暂无积分流水</td></tr>}</tbody></table></div>
        {pagination.page < pagination.pages && <div className="admin-panel-actions"><button className="secondary-button" onClick={onLoadMore}>加载更多流水 <ChevronDown size={15} /></button></div>}
      </section>
    </>
  );
}

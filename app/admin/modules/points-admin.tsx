"use client";

import { Check, ChevronDown, CircleDollarSign, Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { isMemberParticipantRole } from "@/lib/member-roles";
import { useAdminActionDialog } from "./admin-action-dialog";

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

const ledgerTypeLabels: Record<string, string> = {
  VIDEO_REWARD: "视频奖励",
  TRANSFER_IN: "收到转账",
  TRANSFER_OUT: "转出积分",
  ADMIN_ADJUSTMENT: "人工调整",
  REDEMPTION: "礼品兑换",
  REDEMPTION_REFUND: "兑换退款",
  REVERSAL: "奖励撤销",
  WEEKLY_CHALLENGE_REWARD: "周挑战奖励",
  WEEKLY_RACE_REWARD: "周竞速奖励",
  WEEKLY_CHALLENGE_REVERSAL: "周挑战奖励撤销",
  WEEKLY_RACE_REVERSAL: "周竞速奖励撤销",
  MEMBER_CLEARANCE_FORFEIT: "资格清退扣除",
  MEMBER_VOLUNTARY_EXIT_FORFEIT: "自愿退出扣除",
  BIRTHDAY_DRAW_REWARD: "生日抽奖奖励",
  BIRTHDAY_VIDEO_BONUS: "生日作品加成",
};

function ledgerTypeLabel(type: string) {
  return ledgerTypeLabels[type] ?? "其他积分变动";
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
  onSearchMembers,
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
  onSearchMembers: (query: string) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedMembersById, setSelectedMembersById] = useState<Record<string, AdminUserRow>>({});
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
  const [activeTask, setActiveTask] = useState<"adjust" | "rules" | "ledger">("adjust");
  const { ask, dialog } = useAdminActionDialog();

  const activeMembers = users.filter((user) => user.active && isMemberParticipantRole(user.role));
  const filteredMembers = activeMembers;
  const numericAmount = Number(amount);
  const selectedMembers = selectedIds
    .map((id) => activeMembers.find((user) => user.id === id) ?? selectedMembersById[id])
    .filter((user): user is AdminUserRow => Boolean(user));
  const insufficientMembers = selectedMembers.filter((user) => (user.account?.balance ?? 0) + numericAmount < 0);

  function clearSelection() {
    setSelectedIds([]);
    setSelectedMembersById({});
  }

  function toggleMember(user: AdminUserRow) {
    if (selectedIds.includes(user.id)) {
      setSelectedIds((current) => current.filter((id) => id !== user.id));
      setSelectedMembersById((current) => { const next = { ...current }; delete next[user.id]; return next; });
      return;
    }
    setSelectedIds((current) => [...current, user.id]);
    setSelectedMembersById((current) => ({ ...current, [user.id]: user }));
  }

  function selectCurrentResults() {
    setSelectedIds((current) => [...new Set([...current, ...filteredMembers.map((user) => user.id)])]);
    setSelectedMembersById((current) => Object.fromEntries([...Object.entries(current), ...filteredMembers.map((user) => [user.id, user])]));
  }

  async function submitMemberSearch() {
    setError("");
    await onSearchMembers(memberSearch.trim());
  }

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
      clearSelection();
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
    const confirmed = await ask({
      title: "确认保存视频积分规则",
      label: "确认",
      description: "新规则只影响之后新抓取的视频，不会重算历史积分。",
      impact: [
        { label: "基础档", value: `${values.minimumLikes}–${values.fixedTierMaxLikes} 赞发放 ${values.fixedTierPoints} 分` },
        { label: "浮动档", value: `点赞量 ÷ ${values.likesDivisor}，最高 ${values.maximumPoints} 分` },
        { label: "提交窗口", value: `${values.submissionWindowDays} 天` },
        { label: "生效影响", value: "保存后立即用于新抓取视频，并记录审计日志", tone: "warning" },
      ],
      confirmationOnly: true,
      confirmLabel: "确认保存规则",
    });
    if (confirmed === null) return;
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
      <nav className="admin-tabs admin-task-tabs" aria-label="积分管理任务">
        <button className={activeTask === "adjust" ? "active" : ""} aria-current={activeTask === "adjust" ? "page" : undefined} onClick={() => setActiveTask("adjust")}>人工调整<span>{selectedIds.length}</span></button>
        <button className={activeTask === "rules" ? "active" : ""} aria-current={activeTask === "rules" ? "page" : undefined} onClick={() => setActiveTask("rules")}>积分规则</button>
        <button className={activeTask === "ledger" ? "active" : ""} aria-current={activeTask === "ledger" ? "page" : undefined} onClick={() => setActiveTask("ledger")}>积分流水<span>{pagination.total}</span></button>
      </nav>
      {activeTask !== "ledger" && <div className="admin-dashboard-grid points-task-grid">
        {activeTask === "adjust" &&
        <section className="admin-panel audit-panel">
          <div className="admin-panel-head"><div><h2>人工增减积分</h2><p>扣减不能超过成员当前余额；撤销类补偿由系统专用流程处理。</p></div><CircleDollarSign size={19} color="#149e91" /></div>
          <div className="field admin-panel-form">
            <label htmlFor="points-member-search">成员（{selectionMode === "ALL_ACTIVE_MEMBERS" ? "全部有效普通成员" : `已选 ${selectedIds.length} 人`}）</label>
            <div className="member-picker-toolbar">
              <div className="admin-search"><Search size={15} /><input id="points-member-search" value={memberSearch} disabled={selectionMode === "ALL_ACTIVE_MEMBERS"} onChange={(event) => setMemberSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitMemberSearch(); }} placeholder="搜索昵称或快手 ID" /></div>
              <button className="icon-button" title="搜索成员" aria-label="搜索成员" disabled={selectionMode === "ALL_ACTIVE_MEMBERS"} onClick={() => void submitMemberSearch()}><Search size={16} /></button>
              <button className="text-button" onClick={() => { setSelectionMode("ALL_ACTIVE_MEMBERS"); clearSelection(); }}>全部有效成员</button>
              <button className="text-button" disabled={selectionMode === "ALL_ACTIVE_MEMBERS"} onClick={selectCurrentResults}>选择当前结果</button>
              <button className="text-button" onClick={() => { setSelectionMode("EXPLICIT"); clearSelection(); }} disabled={selectionMode === "EXPLICIT" && !selectedIds.length}>清空</button>
            </div>
            {selectionMode === "ALL_ACTIVE_MEMBERS" ? <p className="field-hint">提交时由服务端在同一事务内选取全部有效普通成员，不受当前分页影响。</p> : <>
              <div className="points-member-list">{filteredMembers.map((user) => <label className="checkbox-field" key={user.id}><input type="checkbox" checked={selectedIds.includes(user.id)} onChange={() => toggleMember(user)} /><span>{user.nickname} · {user.kuaishouId}</span><b>{(user.account?.balance ?? 0).toLocaleString()} 分</b></label>)}{filteredMembers.length === 0 && <span className="field-hint">没有匹配的有效普通成员</span>}</div>
              {membersPagination.page < membersPagination.pages && <button className="secondary-button compact-button" onClick={() => void onLoadMoreMembers()}>加载更多成员 <ChevronDown size={15} /></button>}
            </>}
          </div>
          <div className="field admin-panel-form"><label htmlFor="points-amount">每人积分变动</label><input id="points-amount" type="number" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="正数发放，负数扣除" /></div>
          <div className="field admin-panel-form"><label htmlFor="points-reason">原因</label><textarea id="points-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="例如：活动补发、人工纠错、违规扣分" /></div>
          {confirming && <div className="points-confirmation"><strong>请确认本次批量调整</strong><span>{selectionMode === "ALL_ACTIVE_MEMBERS" ? "全部有效普通成员（最终人数由服务端事务确认）" : `${selectedIds.length} 名成员`}，每人 {numericAmount > 0 ? "+" : ""}{numericAmount.toLocaleString()} 分{selectionMode === "EXPLICIT" ? `，合计 ${numericAmount > 0 ? "+" : ""}${(numericAmount * selectedIds.length).toLocaleString()} 分` : ""}</span>{selectionMode === "EXPLICIT" && <div className="points-balance-preview">{selectedMembers.slice(0, 5).map((member) => { const before = member.account?.balance ?? 0; const after = before + numericAmount; return <span className={after < 0 ? "is-danger" : ""} key={member.id}><b>{member.nickname}</b>{before.toLocaleString()} → {after.toLocaleString()} 分</span>; })}{selectedMembers.length > 5 && <small>另有 {selectedMembers.length - 5} 名成员将在提交时更新</small>}</div>}{insufficientMembers.length > 0 && <span className="negative-text">有 {insufficientMembers.length} 名成员余额不足，请减少扣除积分或取消选择。</span>}<span>原因：{reason.trim()}</span><div><button className="secondary-button compact-button" onClick={() => setConfirming(false)}>返回修改</button><button className="primary-button compact-button" disabled={saving || insufficientMembers.length > 0} onClick={() => void submitAdjustment()}>{saving ? "提交中..." : "确认调整"}</button></div></div>}
          {!confirming && <div className="admin-panel-actions"><button className="primary-button" disabled={saving} onClick={prepareAdjustment}><CircleDollarSign size={16} />预览批量调整</button></div>}
        </section>}
        {activeTask === "rules" &&
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
        </section>}
      </div>}
      {activeTask === "ledger" && <section className="admin-panel audit-panel">
        <div className="admin-panel-head"><div><h2>积分流水</h2><p>共 {pagination.total} 条，当前显示第 {pagination.page} / {pagination.pages} 页</p></div></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>成员</th><th>类型</th><th>变动</th><th>变动后余额</th><th>说明</th><th>时间</th></tr></thead><tbody>{ledger.map((row) => <tr key={row.id}><td><div className="table-main"><span className="table-avatar">{row.account.user.nickname.slice(0, 1)}</span><div><strong>{row.account.user.nickname}</strong><small>{row.account.user.kuaishouId}</small></div></div></td><td><span>{ledgerTypeLabel(row.type)}</span></td><td className={row.amount >= 0 ? "positive-text" : "negative-text"}>{row.amount >= 0 ? "+" : ""}{row.amount.toLocaleString()}</td><td>{row.balanceAfter.toLocaleString()}</td><td>{row.note ?? "—"}</td><td>{formatAdminDate(row.createdAt)}</td></tr>)}{ledger.length === 0 && <tr><td colSpan={6}>暂无积分流水</td></tr>}</tbody></table></div>
        {pagination.page < pagination.pages && <div className="admin-panel-actions"><button className="secondary-button" onClick={onLoadMore}>加载更多流水 <ChevronDown size={15} /></button></div>}
      </section>}
      {dialog}
    </>
  );
}

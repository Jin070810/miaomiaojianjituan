"use client";

import { useMemo, useState } from "react";
import { CakeSlice, CalendarClock, Gift, PackagePlus, RefreshCw, Sparkles, UserRoundCog, Users } from "lucide-react";

export type BirthdayAdminData = {
  metrics: { activeMembers: number; profiles: number; publicProfiles: number; benefits: number; bonusPoints: number; drawPoints: number };
  prizeGroups: Array<{ kind: string; status: string; _count: { id: number }; _sum: { points: number | null } }>;
  pool: Array<{ id: string; allocatedStock: number; remainingStock: number; active: boolean; gift: { id: string; name: string; kind: string; pointsCost: number; stock: number; active: boolean } }>;
  eligibleGifts: Array<{ id: string; name: string; kind: string; pointsCost: number; stock: number }>;
  upcoming: Array<{ userId: string; nickname: string; month: number; day: number; deltaDays: number }>;
  profiles: Array<{ userId: string; nickname: string; birthMonth: number | null; birthDay: number | null; pendingBirthMonth: number | null; pendingBirthDay: number | null; pendingEffectiveAt: string | null; visibleOnWall: boolean }>;
  pendingClaims: Array<{ id: string; nickname: string; giftName: string; giftKind: string | null; claimExpiresAt: string | null }>;
  drawWindows: Array<{ id: string; nickname: string; benefitYear: number; drawClosesAt: string }>;
};

function birthdayMemberLabel(profile: BirthdayAdminData["profiles"][number]) {
  return `${profile.nickname} · ${profile.birthMonth ? `${profile.birthMonth}月${profile.birthDay}日` : "待登记"}`;
}

export function BirthdayAdmin({ data, onReload }: { data: BirthdayAdminData; onReload: () => Promise<void> }) {
  const [giftId, setGiftId] = useState(data.eligibleGifts[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [memberId, setMemberId] = useState(data.profiles[0]?.userId ?? "");
  const [memberQuery, setMemberQuery] = useState(data.profiles[0] ? birthdayMemberLabel(data.profiles[0]) : "");
  const memberOptions = useMemo(() => {
    const query = memberQuery.trim().toLocaleLowerCase("zh-CN");
    return data.profiles
      .filter((profile) => !query || birthdayMemberLabel(profile).toLocaleLowerCase("zh-CN").includes(query))
      .slice(0, 20);
  }, [data.profiles, memberQuery]);
  const [correctedBirthday, setCorrectedBirthday] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [extensionDays, setExtensionDays] = useState("7");
  const [extensionReason, setExtensionReason] = useState("");

  async function runAction(body: Record<string, unknown>, successMessage: string) {
    setSaving(true); setFeedback("");
    try {
      const response = await fetch("/api/admin/birthdays", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "奖池更新失败");
      setFeedback(successMessage); await onReload();
    } catch (error) { setFeedback(error instanceof Error ? error.message : "生日运营操作失败"); }
    finally { setSaving(false); }
  }

  async function correctBirthday() {
    if (!memberId || !correctedBirthday || correctionReason.trim().length < 2) return;
    setSaving(true); setFeedback("");
    try {
      const response = await fetch(`/api/admin/birthdays/members/${memberId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ birthday: correctedBirthday, reason: correctionReason }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "生日纠错失败");
      setFeedback("生日纠错已记录，将在 7 天后生效。"); setCorrectedBirthday(""); setCorrectionReason(""); await onReload();
    } catch (error) { setFeedback(error instanceof Error ? error.message : "生日纠错失败"); }
    finally { setSaving(false); }
  }

  function extendWindow(target: "draw" | "claim", id: string) {
    const days = Number(extensionDays);
    if (!Number.isInteger(days) || days < 1 || days > 30 || extensionReason.trim().length < 2) {
      setFeedback("请填写 1 至 30 天及至少 2 字的延长原因。"); return;
    }
    void runAction(target === "draw"
      ? { action: "extend_draw", benefitId: id, days, reason: extensionReason }
      : { action: "extend_claim", prizeId: id, days, reason: extensionReason }, "活动窗口已延长并写入审计记录。");
  }

  const coverage = data.metrics.activeMembers ? Math.floor(data.metrics.profiles * 100 / data.metrics.activeMembers) : 0;
  return <div className="admin-page birthday-admin-page">
    <div className="admin-page-title"><div><span className="eyebrow">BIRTHDAY WISHES</span><h1>生日运营</h1><p>管理奖池库存并观察生日权益成本；生日系统与奖励开关位于系统设置。</p></div><button className="icon-button" title="刷新" aria-label="刷新生日数据" onClick={() => void onReload()}><RefreshCw size={19} /></button></div>
    {feedback ? <div className="admin-global-feedback success" role="status"><span>{feedback}</span></div> : null}
    <section className="admin-stat-grid">
      <div className="admin-stat-card"><div className="admin-stat-icon coral"><Users size={19} /></div><span>登记覆盖</span><strong>{coverage}%</strong><small>{data.metrics.profiles} / {data.metrics.activeMembers} 名成员</small></div>
      <div className="admin-stat-card"><div className="admin-stat-icon teal"><CakeSlice size={19} /></div><span>公开生日墙</span><strong>{data.metrics.publicProfiles}</strong><small>由成员主动同意公开</small></div>
      <div className="admin-stat-card"><div className="admin-stat-icon yellow"><Sparkles size={19} /></div><span>本年生日权益</span><strong>{data.metrics.benefits}</strong><small>抽奖积分 {data.metrics.drawPoints.toLocaleString()}</small></div>
      <div className="admin-stat-card"><div className="admin-stat-icon purple"><Gift size={19} /></div><span>作品加成</span><strong>{data.metrics.bonusPoints.toLocaleString()}</strong><small>本年度已发积分</small></div>
    </section>
    <section className="admin-panel birthday-pool-panel">
      <div className="admin-panel-head"><div><h2>商城商品奖池</h2><p>仅支持 10–2000 积分的实物和会员权益；预留后普通商城库存同步扣减。</p></div></div>
      <div className="birthday-pool-form"><select value={giftId} onChange={(event) => setGiftId(event.target.value)}><option value="">选择商城商品</option>{data.eligibleGifts.map((gift) => <option value={gift.id} key={gift.id}>{gift.name} · {gift.pointsCost} 分 · 可用 {gift.stock}</option>)}</select><input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /><button className="primary-button" disabled={saving || !giftId || Number(quantity) <= 0} onClick={() => void runAction({ action: "reserve", giftId, quantity: Number(quantity) }, "生日奖池库存已更新。") }><PackagePlus size={16} />预留库存</button></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>奖品</th><th>商品档位</th><th>累计预留</th><th>剩余</th><th>商城库存</th><th>操作</th></tr></thead><tbody>{data.pool.map((item) => <tr key={item.id}><td><strong>{item.gift.name}</strong><small>{item.gift.kind === "PHYSICAL" ? "实物" : "会员权益"}</small></td><td>{item.gift.pointsCost.toLocaleString()} 分</td><td>{item.allocatedStock}</td><td>{item.remainingStock}</td><td>{item.gift.stock}</td><td><button className="secondary-button mini-button" disabled={saving || item.remainingStock <= 0} onClick={() => void runAction({ action: "release", poolItemId: item.id, quantity: 1 }, "预留库存已返还商城。")}>释放 1 份</button></td></tr>)}{!data.pool.length ? <tr><td colSpan={6}>奖池暂未配置商品；商品档中奖时会自动发放对应保底积分。</td></tr> : null}</tbody></table></div>
    </section>
    <section className="admin-panel"><div className="admin-panel-head"><div><h2>近期寿星</h2><p>未来 30 天的已生效生日资料，包括未公开到生日墙的成员。</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>成员</th><th>生日</th><th>距离今天</th></tr></thead><tbody>{data.upcoming.map((member) => <tr key={member.userId}><td><strong>{member.nickname}</strong></td><td>{member.month} 月 {member.day} 日</td><td>{member.deltaDays === 0 ? "今天" : `${member.deltaDays} 天`}</td></tr>)}{!data.upcoming.length ? <tr><td colSpan={3}>未来 30 天暂无已生效生日。</td></tr> : null}</tbody></table></div></section>
    <section className="admin-panel"><div className="admin-panel-head"><div><h2>生日纠错</h2><p>管理员修正不受 365 天自助限制，但仍在 7 天后生效；审计只记录月日。</p></div><UserRoundCog size={20} /></div><div className="birthday-correction-form"><div className="birthday-member-combobox"><input list="birthday-member-options" value={memberQuery} placeholder="搜索成员昵称" aria-label="搜索并选择成员" onChange={(event) => { const value = event.target.value; setMemberQuery(value); setMemberId(data.profiles.find((profile) => birthdayMemberLabel(profile) === value)?.userId ?? ""); }} /><datalist id="birthday-member-options">{memberOptions.map((profile) => <option key={profile.userId} value={birthdayMemberLabel(profile)} />)}</datalist></div><input type="date" value={correctedBirthday} onChange={(event) => setCorrectedBirthday(event.target.value)} /><input value={correctionReason} maxLength={500} placeholder="纠错原因" onChange={(event) => setCorrectionReason(event.target.value)} /><button className="primary-button" disabled={saving || !memberId || !correctedBirthday || correctionReason.trim().length < 2} onClick={() => void correctBirthday()}>提交纠错</button></div></section>
    <section className="admin-panel"><div className="admin-panel-head"><div><h2>待处理窗口</h2><p>延长或撤回操作必须填写原因。</p></div><CalendarClock size={20} /></div><div className="birthday-window-controls"><label><span>延长天数</span><input type="number" min="1" max="30" step="1" value={extensionDays} onChange={(event) => setExtensionDays(event.target.value)} /></label><label><span>操作原因</span><input value={extensionReason} maxLength={500} onChange={(event) => setExtensionReason(event.target.value)} /></label></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>类型</th><th>成员</th><th>内容</th><th>截止时间</th><th>操作</th></tr></thead><tbody>{data.drawWindows.map((benefit) => <tr key={benefit.id}><td>待抽奖</td><td>{benefit.nickname}</td><td>{benefit.benefitYear} 年权益</td><td>{new Date(benefit.drawClosesAt).toLocaleString("zh-CN")}</td><td><button className="secondary-button mini-button" disabled={saving} onClick={() => extendWindow("draw", benefit.id)}>延长</button></td></tr>)}{data.pendingClaims.map((prize) => <tr key={prize.id}><td>待领奖</td><td>{prize.nickname}</td><td>{prize.giftName}</td><td>{prize.claimExpiresAt ? new Date(prize.claimExpiresAt).toLocaleString("zh-CN") : "-"}</td><td><div className="table-actions"><button className="secondary-button mini-button" disabled={saving} onClick={() => extendWindow("claim", prize.id)}>延长</button><button className="danger-button mini-button" disabled={saving || extensionReason.trim().length < 2} onClick={() => void runAction({ action: "revoke_prize", prizeId: prize.id, reason: extensionReason }, "奖品已撤回，库存已返还商城。")}>撤回</button></div></td></tr>)}{!data.drawWindows.length && !data.pendingClaims.length ? <tr><td colSpan={5}>当前没有待处理窗口。</td></tr> : null}</tbody></table></div></section>
    <section className="admin-panel"><div className="admin-panel-head"><div><h2>抽奖分布</h2><p>结果按服务端票号和 `birthday-draw-v1` 概率生成。</p></div></div><div className="birthday-prize-groups">{data.prizeGroups.map((group) => <span key={`${group.kind}-${group.status}`}><b>{group.kind === "POINTS" ? "积分" : "商品"}</b><strong>{group._count.id}</strong><small>{group.status}</small></span>)}{!data.prizeGroups.length ? <p className="empty-copy">本年度还没有抽奖记录。</p> : null}</div></section>
  </div>;
}

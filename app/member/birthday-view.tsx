"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, ChevronRight, Gift, PartyPopper, Send, Sparkles, Star, X } from "lucide-react";
import { fetchMemberJson } from "@/lib/member-fetch";
import type { MembershipFieldDefinition } from "@/lib/gifts";
import { miaoAssets } from "./visual-assets";

type BirthdayProfile = { birthday: string | null; pendingBirthday: string | null; pendingEffectiveAt: string | null; visibleOnWall: boolean; nextSelfChangeAt: string | null };
type BirthdayPrize = { id: string; kind: "POINTS" | "GIFT"; points: number | null; status: "GRANTED" | "PENDING_CLAIM" | "CLAIMED" | "EXPIRED" | "REVOKED"; claimExpiresAt: string | null; gift: { id: string; name: string; kind: "PHYSICAL" | "MEMBERSHIP"; imageUrl: string | null; fulfillmentFields: unknown } | null; redemptionOrder: { id: string; status: string } | null };
type BirthdayBenefit = { id: string; benefitYear: number; occurrenceDate: string; drawOpensAt: string; drawClosesAt: string; bonusGranted: number; prize: BirthdayPrize | null };
type BirthdayMeData = { profile: BirthdayProfile | null; benefits: BirthdayBenefit[]; wishes: Array<{ id: string; benefitYear: number; presetCode: string; createdAt: string; sender: { id: string; nickname: string; avatarUrl: string | null } }>; presets: Array<{ code: string; label: string; message: string }>; drawPolicyVersion: string };
type WallMember = { userId: string; nickname: string; avatarUrl: string | null; month: number; day: number; benefitYear: number; occurrenceDate: string; deltaDays: number; wishCount: number; myWish: string | null; canWish: boolean };
type BirthdayWallData = { today: WallMember[]; wishable: WallMember[]; upcoming: WallMember[]; presets: BirthdayMeData["presets"] };

const PROBABILITIES = [["10 积分", "12%"], ["20 积分", "14%"], ["50 积分", "20%"], ["100 积分", "22%"], ["200 积分", "16%"], ["500 积分", "7%"], ["1000 积分", "1%"], ["10–199 分商品", "4%"], ["200–499 分商品", "2%"], ["500–999 分商品", "1.5%"], ["1000–2000 分商品", "0.5%"]] as const;

function avatar(member: { nickname: string; avatarUrl: string | null }) { return member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : <span>{member.nickname.slice(0, 1)}</span>; }
function dateLabel(month: number, day: number) { return `${month} 月 ${day} 日`; }
function benefitIsOpen(benefit: BirthdayBenefit, now = Date.now()) { return now >= new Date(benefit.drawOpensAt).getTime() && now < new Date(benefit.drawClosesAt).getTime(); }
function drawRemainingLabel(closesAt: string) { const remaining = Math.max(0, new Date(closesAt).getTime() - Date.now()); const hours = Math.ceil(remaining / 3_600_000); return hours > 24 ? `剩余 ${Math.floor(hours / 24)} 天 ${hours % 24} 小时` : `剩余 ${hours} 小时`; }
function shanghaiToday() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function membershipFields(value: unknown): MembershipFieldDefinition[] { return Array.isArray(value) ? value.filter((field): field is MembershipFieldDefinition => Boolean(field && typeof field === "object" && "key" in field && "label" in field)) : []; }

export function BirthdayEntry({ onOpen }: { onOpen: () => void }) {
  return <section className="birthday-entry" aria-labelledby="birthday-entry-title"><img src={miaoAssets.actions.gift.src} alt="" /><div><span>团友生日册</span><h2 id="birthday-entry-title">生日星愿</h2><p>登记生日、抽取年度心意，也为团友送上一张祝福卡。</p></div><button onClick={onOpen} aria-label="进入生日星愿"><ChevronRight size={22} /></button></section>;
}

export default function BirthdayView({ onBack, onBalanceChanged }: { onBack: () => void; onBalanceChanged: () => void }) {
  const [me, setMe] = useState<BirthdayMeData | null>(null);
  const [wall, setWall] = useState<BirthdayWallData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [birthday, setBirthday] = useState("");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [selectedWish, setSelectedWish] = useState<WallMember | null>(null);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [transferMember, setTransferMember] = useState<WallMember | null>(null);
  const [transferAmount, setTransferAmount] = useState("");
  const [transferError, setTransferError] = useState("");
  const [claimPrize, setClaimPrize] = useState<BirthdayPrize | null>(null);
  const [claimFields, setClaimFields] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const [nextMe, nextWall] = await Promise.all([fetchMemberJson<BirthdayMeData>("/api/birthdays/me", "生日资料加载失败"), fetchMemberJson<BirthdayWallData>("/api/birthdays/wall", "生日墙加载失败")]);
      setMe(nextMe); setWall(nextWall); setBirthday(nextMe.profile?.pendingBirthday ?? nextMe.profile?.birthday ?? ""); setVisible(nextMe.profile?.visibleOnWall ?? false);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "生日星愿加载失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const openBenefit = useMemo(() => me?.benefits.find((benefit) => benefitIsOpen(benefit)) ?? null, [me]);
  const receivedPreset = useMemo(() => new Map(me?.presets.map((preset) => [preset.code, preset]) ?? []), [me]);

  async function saveProfile() {
    setSaving(true); setFeedback("");
    try {
      const storedBirthday = me?.profile?.pendingBirthday ?? me?.profile?.birthday ?? "";
      const birthdayChanged = Boolean(birthday && birthday !== storedBirthday);
      const response = await fetch("/api/birthdays/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(birthdayChanged ? { birthday } : {}), visibleOnWall: visible }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "生日资料保存失败");
      setFeedback(birthdayChanged ? "生日资料已保存，新日期将在 7 天后生效。" : visible ? "生日墙公开状态已立即开启。" : "生日墙公开状态已立即关闭。"); await load();
    } catch (saveError) { setFeedback(saveError instanceof Error ? saveError.message : "生日资料保存失败"); }
    finally { setSaving(false); }
  }
  async function draw() {
    setDrawing(true); setFeedback("");
    try {
      const response = await fetch("/api/birthdays/draw", { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } }); const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "抽奖失败");
      setFeedback(result.prize.kind === "POINTS" ? `抽中了 ${result.prize.points} 积分，已经到账。` : `抽中了 ${result.prize.gift?.name ?? "生日礼物"}！`); onBalanceChanged(); await load();
    } catch (drawError) { setFeedback(drawError instanceof Error ? drawError.message : "抽奖失败"); }
    finally { setDrawing(false); }
  }
  async function sendWish() {
    if (!selectedWish || !selectedPreset) return; setSaving(true);
    try {
      const response = await fetch("/api/birthdays/wishes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipientId: selectedWish.userId, benefitYear: selectedWish.benefitYear, presetCode: selectedPreset }) }); const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "祝福发送失败"); setFeedback(`祝福卡已送给 ${selectedWish.nickname}。`); setSelectedWish(null); await load();
    } catch (wishError) { setFeedback(wishError instanceof Error ? wishError.message : "祝福发送失败"); }
    finally { setSaving(false); }
  }
  async function transferPoints() {
    if (!transferMember) return; setSaving(true); setTransferError("");
    try {
      const amount = Number(transferAmount); if (!Number.isInteger(amount) || amount <= 0) throw new Error("请输入正整数积分");
      const response = await fetch("/api/transfers", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ receiverId: transferMember.userId, amount, note: "生日快乐" }) }); const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "积分赠送失败"); setFeedback(`已向 ${transferMember.nickname} 送出 ${amount} 积分。`); setTransferMember(null); setTransferAmount(""); onBalanceChanged();
    } catch (failure) { setTransferError(failure instanceof Error ? failure.message : "积分赠送失败"); }
    finally { setSaving(false); }
  }
  async function submitClaim() {
    if (!claimPrize) return; setSaving(true);
    try {
      const gift = claimPrize.gift; const body = gift?.kind === "PHYSICAL" ? { recipientName: claimFields.recipientName, phone: claimFields.phone, address: claimFields.address } : { membershipAnswers: claimFields };
      const response = await fetch(`/api/birthdays/prizes/${claimPrize.id}/claim`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) }); const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "领奖失败"); setFeedback("领奖资料已提交，礼物进入处理流程。"); setClaimPrize(null); setClaimFields({}); await load();
    } catch (claimError) { setFeedback(claimError instanceof Error ? claimError.message : "领奖失败"); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="member-content birthday-page birthday-state"><span className="growth-loading-bar" /><p>正在打开生日星愿…</p></div>;
  if (error || !me || !wall) return <div className="member-content birthday-page birthday-state is-error"><p>{error || "生日星愿暂时不可用"}</p><button className="journal-primary" onClick={() => void load()}>重新加载</button></div>;
  return <div className="member-content journal-page birthday-page">
    <button className="achievement-back" type="button" aria-label="返回首页" onClick={onBack}><ArrowLeft size={20} /></button>
    <section className="birthday-hero"><div><span className="journal-kicker">生日星愿</span><h1>把今天的好心情装进礼物里</h1><p>生日当天抽一份年度心意，通过的作品还能获得 20% 积分加成。</p></div><img src={miaoAssets.actions.award.src} alt={miaoAssets.actions.award.alt} /></section>
    {feedback ? <p className="birthday-feedback" role="status">{feedback}</p> : null}
    <section className="birthday-profile-panel"><div className="birthday-section-title"><span><CalendarDays size={19} />我的生日</span><b>{me.profile?.pendingEffectiveAt ? "待生效" : me.profile?.birthday ? "已登记" : "未登记"}</b></div><div className="birthday-profile-form"><label><span>生日日期</span><input type="date" value={birthday} max={shanghaiToday()} onChange={(event) => setBirthday(event.target.value)} /></label><label className="birthday-consent"><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} /><span>同意在生日墙公开我的昵称、头像和生日月日</span></label><button className="journal-primary" disabled={saving || !birthday} onClick={() => void saveProfile()}>{saving ? "正在保存…" : "保存生日资料"}</button></div>{me.profile?.pendingEffectiveAt ? <small>新日期将在 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(me.profile.pendingEffectiveAt))} 生效。</small> : null}{me.profile?.nextSelfChangeAt ? <small>下一次可修改日期：{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(me.profile.nextSelfChangeAt))}。公开状态可随时调整。</small> : null}</section>
    <section className="birthday-draw-panel"><div><span className="journal-kicker">年度生日扭蛋</span><h2>{openBenefit?.prize ? "今年的星愿已经揭晓" : "每年一次，必有心意"}</h2><p>{openBenefit ? drawRemainingLabel(openBenefit.drawClosesAt) : "抽奖从生日当天开放 7 天"}；积分立即到账，商品需在 30 天内领奖。</p></div>{openBenefit?.prize ? <div className="birthday-prize-result"><PartyPopper size={24} /><strong>{openBenefit.prize.kind === "POINTS" ? `${openBenefit.prize.points} 积分` : openBenefit.prize.gift?.name}</strong></div> : <button className="birthday-draw-button" disabled={!openBenefit || drawing} onClick={() => void draw()}><Sparkles size={20} />{drawing ? "正在开启…" : openBenefit ? "开启生日星愿" : "生日当天开放"}</button>}<details><summary>查看公开概率</summary><p className="birthday-policy-note">{me.drawPolicyVersion} · 直接积分奖期望值 113 分</p><div className="birthday-probability-grid">{PROBABILITIES.map(([label, probability]) => <span key={label}><b>{label}</b><small>{probability}</small></span>)}</div></details></section>
    <BirthdayPeopleSection title="今日寿星" caption={`${wall.today.length} 位`} members={wall.today} empty="今天没有公开生日的团友，星愿墙安静地亮着。" presets={me.presets} onWish={(member) => { setSelectedWish(member); setSelectedPreset(member.myWish ?? me.presets[0]?.code ?? ""); }} onTransfer={setTransferMember} />
    <BirthdayPeopleSection title="可送祝福" caption="生日前后 7 天" members={wall.wishable.filter((member) => member.deltaDays !== 0)} empty="近期还没有可以送祝福的团友。" presets={me.presets} onWish={(member) => { setSelectedWish(member); setSelectedPreset(member.myWish ?? me.presets[0]?.code ?? ""); }} onTransfer={setTransferMember} />
    <section className="birthday-section"><div className="journal-section-heading ruled"><h2>即将生日</h2><span>未来 30 天</span></div>{wall.upcoming.length ? <div className="birthday-upcoming-list">{wall.upcoming.map((member) => <article key={`${member.userId}-${member.benefitYear}`}><div className="birthday-avatar">{avatar(member)}</div><div><strong>{member.nickname}</strong><small>{dateLabel(member.month, member.day)}</small></div><b>{member.deltaDays === 1 ? "明天" : `${member.deltaDays} 天后`}</b></article>)}</div> : <div className="birthday-empty"><p>未来 30 天暂无公开生日。</p></div>}</section>
    <section className="birthday-section"><div className="journal-section-heading ruled"><h2>我的生日纪念</h2><span>{me.benefits.length} 年</span></div>{me.benefits.length ? <div className="birthday-memory-grid">{me.benefits.map((benefit) => <article key={benefit.id}><span>{benefit.benefitYear}</span><strong>{benefit.prize ? benefit.prize.kind === "POINTS" ? `${benefit.prize.points} 积分` : benefit.prize.gift?.name : "等待开启"}</strong><small>作品加成 {benefit.bonusGranted} 分 · 收到 {me.wishes.filter((wish) => wish.benefitYear === benefit.benefitYear).length} 份祝福</small>{benefit.prize?.status === "PENDING_CLAIM" ? <button onClick={() => { setClaimPrize(benefit.prize); setClaimFields({}); }}>填写领奖资料</button> : null}</article>)}</div> : <div className="birthday-empty"><img src={miaoAssets.actions.gift.src} alt="" /><p>完成第一次生日抽奖后，这里会留下你的年度纪念。</p></div>}{me.wishes.length ? <div className="birthday-wish-list">{me.wishes.slice(0, 12).map((wish) => <article key={wish.id}><div className="birthday-avatar">{avatar(wish.sender)}</div><div><strong>{wish.sender.nickname}</strong><p>{receivedPreset.get(wish.presetCode)?.message ?? "送来一份生日祝福"}</p></div></article>)}</div> : null}</section>
    {selectedWish ? <BirthdayModal title="选择一张祝福卡" eyebrow={`送给 ${selectedWish.nickname}`} onClose={() => setSelectedWish(null)}><div className="birthday-preset-list">{me.presets.map((preset) => <label key={preset.code} className={selectedPreset === preset.code ? "selected" : ""}><input type="radio" name="birthday-preset" checked={selectedPreset === preset.code} onChange={() => setSelectedPreset(preset.code)} /><strong>{preset.label}</strong><span>{preset.message}</span></label>)}</div><button className="journal-primary full-button" disabled={!selectedPreset || saving} onClick={() => void sendWish()}><Send size={17} />送出祝福卡</button></BirthdayModal> : null}
    {transferMember ? <BirthdayModal title={`送积分给 ${transferMember.nickname}`} eyebrow="生日积分心意" onClose={() => setTransferMember(null)}><label className="field"><span>赠送积分</span><input type="number" min="1" step="1" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} placeholder="请输入正整数" /></label><p className="field-hint">积分来自你的现有余额，备注固定为“生日快乐”。</p>{transferError ? <p className="form-error">{transferError}</p> : null}<button className="journal-primary full-button" disabled={saving || !transferAmount} onClick={() => void transferPoints()}><Send size={17} />确认送出</button></BirthdayModal> : null}
    {claimPrize?.gift ? <BirthdayModal title={claimPrize.gift.name} eyebrow="生日礼物领奖" onClose={() => setClaimPrize(null)}>{claimPrize.gift.kind === "PHYSICAL" ? <><ClaimField label="收货姓名" value={claimFields.recipientName} onChange={(value) => setClaimFields((current) => ({ ...current, recipientName: value }))} /><ClaimField label="手机号" value={claimFields.phone} onChange={(value) => setClaimFields((current) => ({ ...current, phone: value }))} /><label className="field"><span>详细地址</span><textarea rows={3} value={claimFields.address ?? ""} onChange={(event) => setClaimFields((current) => ({ ...current, address: event.target.value }))} /></label></> : membershipFields(claimPrize.gift.fulfillmentFields).map((field) => <ClaimField key={field.key} label={field.label} value={claimFields[field.key]} placeholder={field.placeholder} onChange={(value) => setClaimFields((current) => ({ ...current, [field.key]: value }))} />)}<button className="journal-primary full-button" disabled={saving} onClick={() => void submitClaim()}><Gift size={17} />提交领奖资料</button></BirthdayModal> : null}
  </div>;
}

function BirthdayPeopleSection({ title, caption, members, empty, onWish, onTransfer }: { title: string; caption: string; members: WallMember[]; empty: string; presets: BirthdayMeData["presets"]; onWish: (member: WallMember) => void; onTransfer: (member: WallMember) => void }) { return <section className="birthday-section"><div className="journal-section-heading ruled"><h2>{title}</h2><span>{caption}</span></div>{members.length ? <div className="birthday-person-grid">{members.map((member) => <article className={member.deltaDays === 0 ? "birthday-person is-today" : "birthday-person"} key={`${member.userId}-${member.benefitYear}`}><div className="birthday-avatar">{avatar(member)}</div><div><span>{member.deltaDays === 0 ? "今日寿星" : dateLabel(member.month, member.day)}</span><strong>{member.nickname}</strong><small>{member.wishCount} 份祝福</small></div>{member.canWish ? <div className="birthday-person-actions"><button onClick={() => onWish(member)}><Send size={15} />{member.myWish ? "更换祝福" : "送祝福"}</button><button title="赠送积分" aria-label={`送积分给${member.nickname}`} onClick={() => onTransfer(member)}><Gift size={16} /></button></div> : null}</article>)}</div> : <div className="birthday-empty"><Star size={24} /><p>{empty}</p></div>}</section>; }
function BirthdayModal({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal-sheet birthday-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={20} /></button></header>{children}</section></div>; }
function ClaimField({ label, value, placeholder, onChange }: { label: string; value?: string; placeholder?: string; onChange: (value: string) => void }) { return <label className="field"><span>{label}</span><input value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>; }

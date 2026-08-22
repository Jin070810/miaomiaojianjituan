"use client";

import { ArrowRight, Eye, EyeSlash, LockKey, ShieldCheck, User } from "@phosphor-icons/react";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BrandIcon } from "../../member/brand";

type ApplicationStatus = { id: string; status: "PENDING" | "APPROVED" | "REJECTED"; reviewReason: string | null; createdAt: string; reviewedAt: string | null };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [available, setAvailable] = useState<boolean | null>(null);
  const [nickname, setNickname] = useState("");
  const [kuaishouId, setKuaishouId] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [guild, setGuild] = useState(false);
  const [phone, setPhone] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [statusLookup, setStatusLookup] = useState({ applicationId: "", queryToken: "" });
  const [application, setApplication] = useState<ApplicationStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/join/${encodeURIComponent(token)}`, { cache: "no-store" }).then((response) => response.json()).then((result) => { if (mounted) setAvailable(Boolean(result.available)); }).catch(() => { if (mounted) setAvailable(false); });
    return () => { mounted = false; };
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) { setError("两次输入的密码不一致"); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/join/${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kuaishouId, nickname, password, guildStatus: guild ? "已入会" : "未绑定", boundPhone: guild ? undefined : phone }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "申请提交失败");
      setStatusLookup({ applicationId: result.applicationId, queryToken: result.queryToken });
      setApplication({ id: result.applicationId, status: "PENDING", reviewReason: null, createdAt: new Date().toISOString(), reviewedAt: null });
      setPassword(""); setConfirmPassword("");
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "申请提交失败"); } finally { setLoading(false); }
  }

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setLoading(true);
    try {
      const query = new URLSearchParams(statusLookup);
      const response = await fetch(`/api/join/status?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "查询失败");
      setApplication(result);
    } catch (lookupError) { setError(lookupError instanceof Error ? lookupError.message : "查询失败"); } finally { setLoading(false); }
  }

  return <main className="auth-shell"><div className="auth-journal"><section className="auth-hero"><div className="auth-brand"><BrandIcon className="auth-mark" /><span>妙妙剪辑团<small>直播高光积分站</small></span></div><div className="auth-hero-copy"><h1>申请加入剪辑团</h1><p>填写资料后，等待审核员确认</p></div></section><section className="auth-panel">
    {available === false ? <><div className="auth-tabs"><button className="active">链接已失效</button></div><div className="auth-form"><p className="field-hint">这个专属入团链接已停用或过期，请联系审核员获取新的链接。</p></div></> : <>
      <div className="auth-tabs"><button className="active">填写申请</button></div>
      <form className="auth-form" onSubmit={submit}>
        <div className="field"><label htmlFor="join-nickname">快手昵称</label><div className="auth-input"><User size={22} /><input id="join-nickname" autoComplete="name" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="输入你的快手昵称" required /></div></div>
        <div className="field"><label htmlFor="join-ksid">快手 ID</label><div className="auth-input"><User size={22} /><input id="join-ksid" autoComplete="username" value={kuaishouId} onChange={(event) => setKuaishouId(event.target.value)} placeholder="输入快手 ID" required /></div></div>
        <div className="field"><label htmlFor="join-password">密码</label><div className="auth-input"><LockKey size={22} /><input id="join-password" autoComplete="new-password" type={showPassword ? "text" : "password"} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位密码" required /><button type="button" className="toggle-password" aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeSlash size={21} /> : <Eye size={21} />}</button></div></div>
        <div className="field"><label htmlFor="join-confirm-password">确认密码</label><div className="auth-input"><LockKey size={22} /><input id="join-confirm-password" autoComplete="new-password" type={showPassword ? "text" : "password"} minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入密码" required /></div></div>
        <div className="guild-check"><label><input type="checkbox" checked={guild} onChange={(event) => setGuild(event.target.checked)} /><span className="check-box" /><span>我已绑定公会</span></label>{!guild && <input className="phone-input" aria-label="快手绑定手机号" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="未绑定时填写快手绑定手机号" required />}</div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-button auth-submit" disabled={loading || available === null}>{loading ? "请稍等..." : "提交入团申请"} <ArrowRight size={20} /></button>
      </form>
    </>}
    {application && <section className="auth-form" aria-live="polite"><p className="field-hint"><ShieldCheck size={16} />申请编号：{application.id}<br />查询凭证：{statusLookup.queryToken}<br />请保存以上两项，提交时间：{formatDate(application.createdAt)}<br />当前状态：{application.status === "PENDING" ? "等待审核" : application.status === "APPROVED" ? "审核通过，请返回登录" : "申请已驳回"}{application.reviewReason && <><br />驳回原因：{application.reviewReason}</>}</p></section>}
    <section className="auth-form"><p className="field-hint">已有申请？使用申请编号和查询凭证查看进度。</p><form onSubmit={lookup}><div className="field"><label htmlFor="join-application-id">申请编号</label><input id="join-application-id" value={statusLookup.applicationId} onChange={(event) => setStatusLookup((current) => ({ ...current, applicationId: event.target.value }))} /></div><div className="field"><label htmlFor="join-query-token">查询凭证</label><input id="join-query-token" value={statusLookup.queryToken} onChange={(event) => setStatusLookup((current) => ({ ...current, queryToken: event.target.value }))} /></div><button className="secondary-button full-button" disabled={loading}>查询申请状态</button></form></section>
    <div className="auth-security"><ShieldCheck size={15} /><span>审核通过后才会创建账号，申请期间不会产生登录会话或积分账户</span></div>
  </section></div></main>;
}

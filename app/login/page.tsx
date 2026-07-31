"use client";

import {
  ArrowRight,
  Eye,
  EyeSlash,
  LockKey,
  ShieldCheck,
  User,
} from "@phosphor-icons/react";
import Image from "next/image";
import { FormEvent, useState } from "react";
import { BrandIcon } from "../member/brand";
import { miaoAssets } from "../member/visual-assets";

function Mark() {
  return <BrandIcon className="auth-mark" />;
}

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [showPassword, setShowPassword] = useState(false);
  const [guild, setGuild] = useState(false);
  const [kuaishouId, setKuaishouId] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function switchMode(nextMode: "login" | "register" | "reset") {
    setMode(nextMode);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "reset" && password !== confirmPassword) throw new Error("两次输入的新密码不一致");
      const endpoint = mode === "login" ? "/api/auth/login" : mode === "register" ? "/api/auth/register" : "/api/auth/password-reset-requests";
      const payload = mode === "login"
        ? { kuaishouId, password }
        : mode === "register"
          ? { kuaishouId, nickname, password, guildStatus: guild ? "已入会" : "未绑定", boundPhone: guild ? undefined : phone }
          : { kuaishouId, password };
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "操作失败");
      if (mode === "reset") {
        setError("找回申请已提交。请联系审核员完成身份核验后再使用新密码登录。");
        setPassword("");
        setConfirmPassword("");
        return;
      }
      // Verify that the WebView has committed the session cookie before a
      // document navigation. Some embedded browsers can race a client-side
      // router transition and send the first member request without it.
      const sessionCheck = await fetch("/api/me", { cache: "no-store" });
      if (!sessionCheck.ok) {
        throw new Error("登录状态没有保存。请清理微信网页缓存后重试，或使用系统浏览器打开。");
      }
      window.location.assign(result.user?.role === "ADMIN" ? "/admin" : "/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "操作失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-journal">
        <section className="auth-hero">
          <div className="auth-brand"><Mark /><span>妙妙剪辑团<small>直播高光积分站</small></span></div>
          <div className="auth-hero-copy">
            <h1>{mode === "login" ? "欢迎回来" : mode === "register" ? "加入剪辑团" : "找回账号"}</h1>
            <p>{mode === "reset" ? "提交申请后，请联系审核员完成身份核验" : "和妙妙一起，把高光剪成积分"}</p>
          </div>
          <div className="auth-character-stage">
            <Image className="auth-swoosh" src={miaoAssets.v3.heroSwoosh} alt="" width={1440} height={1080} priority />
            <Image className="auth-character" src={miaoAssets.v3.characters.welcome} alt={miaoAssets.actions.welcome.alt} width={720} height={980} quality={95} priority />
          </div>
        </section>
        <section className="auth-panel">
            <div className="auth-tabs">
              <button className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>登录</button>
              <button className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>注册</button>
            </div>
            {mode === "reset" && <div className="auth-form"><p className="field-hint">填写快手 ID 和新密码后提交申请，再联系审核员完成线下身份核验。申请会在 24 小时后失效。</p></div>}
            <form className="auth-form" onSubmit={submit}>
              {mode === "register" && (
                <>
                  <div className="field">
                    <label htmlFor="nickname">快手昵称</label>
                    <div className="auth-input"><User size={22} /><input id="nickname" autoComplete="name" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="输入你的快手昵称" /></div>
                  </div>
                </>
              )}
              <div className="field">
                <label htmlFor="ksid">快手 ID</label>
                <div className="auth-input"><User size={22} /><input id="ksid" autoComplete="username" value={kuaishouId} onChange={(event) => setKuaishouId(event.target.value)} placeholder="输入快手 ID" /></div>
              </div>
              <div className="field">
                <label htmlFor="password">{mode === "reset" ? "新密码" : "密码"}</label>
                <div className="auth-input">
                  <LockKey size={22} />
                  <input id="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} minLength={mode === "login" ? 6 : 8} placeholder={mode === "login" ? "请输入密码" : "至少 8 位密码"} />
                  <button type="button" className="toggle-password" aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeSlash size={21} /> : <Eye size={21} />}
                  </button>
                </div>
              </div>
              {mode === "reset" && <div className="field"><label htmlFor="confirm-password">确认新密码</label><div className="auth-input"><LockKey size={22} /><input id="confirm-password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type={showPassword ? "text" : "password"} minLength={8} placeholder="再次输入新密码" /></div></div>}
              {mode === "register" && (
                <div className="guild-check">
                  <label>
                    <input type="checkbox" checked={guild} onChange={(event) => setGuild(event.target.checked)} />
                    <span className="check-box" />
                    <span>我已绑定公会</span>
                  </label>
                    {!guild && <input className="phone-input" aria-label="快手绑定手机号" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="未绑定时填写快手绑定手机号" />}
                </div>
              )}
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button full-button auth-submit" disabled={loading}>
                {loading ? "请稍等..." : mode === "login" ? "进入剪辑团" : mode === "register" ? "创建账号" : "提交找回申请"} <ArrowRight size={20} />
              </button>
            </form>
            {mode === "login" && <button className="forgot-password" type="button" onClick={() => switchMode("reset")}>忘记密码？提交找回申请</button>}
            {mode === "reset" && <button className="forgot-password" type="button" onClick={() => switchMode("login")}>返回登录</button>}
            <div className="auth-security"><ShieldCheck size={15} /><span>你的积分和兑换记录会被好好保存</span></div>
        </section>
      </div>
    </main>
  );
}

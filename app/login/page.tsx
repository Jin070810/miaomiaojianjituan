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
import { useRouter } from "next/navigation";
import { BrandIcon } from "../member/brand";
import { miaoAssets } from "../member/visual-assets";

function Mark() {
  return <BrandIcon className="auth-mark" />;
}

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [showPassword, setShowPassword] = useState(false);
  const [guild, setGuild] = useState(false);
  const [kuaishouId, setKuaishouId] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function switchMode(nextMode: "login" | "register") {
    setMode(nextMode);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = mode === "login"
        ? { kuaishouId, password }
        : { kuaishouId, nickname, password, guildStatus: guild ? "已入会" : "未绑定", boundPhone: guild ? undefined : phone };
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "操作失败");
      router.push(result.user?.role === "ADMIN" ? "/admin" : "/");
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
            <h1>{mode === "login" ? "欢迎回来" : "加入剪辑团"}</h1>
            <p>和妙妙一起，把高光剪成积分</p>
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
                <label htmlFor="password">密码</label>
                <div className="auth-input">
                  <LockKey size={22} />
                  <input id="password" autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} minLength={mode === "register" ? 8 : 6} placeholder={mode === "register" ? "至少 8 位密码" : "请输入密码"} />
                  <button type="button" className="toggle-password" aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeSlash size={21} /> : <Eye size={21} />}
                  </button>
                </div>
              </div>
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
                {loading ? "请稍等..." : mode === "login" ? "进入剪辑团" : "创建账号"} <ArrowRight size={20} />
              </button>
            </form>
            {mode === "login" && <button className="forgot-password">忘记密码？联系管理员重置</button>}
            <div className="auth-security"><ShieldCheck size={15} /><span>你的积分和兑换记录会被好好保存</span></div>
        </section>
      </div>
    </main>
  );
}

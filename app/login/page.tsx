"use client";

import {
  ArrowRight,
  Eye,
  EyeOff,
  HelpCircle,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
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
      <div className="auth-canvas">
        <section className="auth-visual">
          <div className="auth-brand"><Mark /><span>妙妙剪辑团<small>积分中心</small></span></div>
          <div className="auth-visual-copy">
            <span className="eyebrow">欢迎来到妙妙的直播高光站</span>
            <h1>把直播高光，<br /><em>剪成你的积分。</em></h1>
            <p>提交切片、收下积分、和剪辑团一起登上榜单。</p>
          </div>
          <div className="auth-miao-scene">
            <Image src={miaoAssets.scenes.login.src} alt={miaoAssets.scenes.login.alt} width={760} height={520} priority sizes="(max-width: 760px) 100vw, 52vw" />
          </div>
          <div className="auth-stat-strip">
            <div><strong>提交</strong><span>直播切片</span></div>
            <div><strong>查看</strong><span>检查进度</span></div>
            <div><strong>收下</strong><span>积分奖励</span></div>
          </div>
        </section>
        <section className="auth-panel">
          <div className="auth-panel-top">
            <Link href="/" className="auth-mobile-brand"><Mark /><strong>妙妙剪辑团</strong></Link>
            <button className="help-button"><HelpCircle size={17} />帮助中心</button>
          </div>
          <div className="auth-form-wrap">
            <div className="auth-heading">
              <span className="eyebrow">{mode === "login" ? "妙妙和大家在等你" : "加入妙妙剪辑团"}</span>
              <h2>{mode === "login" ? "欢迎回来" : "创建我的账号"}</h2>
              <p>{mode === "login" ? "输入快手 ID 和密码就能进入" : "填写快手信息，开始积累积分"}</p>
            </div>
            <div className="auth-tabs">
              <button className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>登录</button>
              <button className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>注册</button>
            </div>
            <form className="auth-form" onSubmit={submit}>
              {mode === "register" && (
                <>
                  <div className="field">
                    <label htmlFor="nickname">快手昵称</label>
                    <div className="auth-input"><UserRound size={17} /><input id="nickname" autoComplete="name" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="输入你的快手昵称" /></div>
                  </div>
                </>
              )}
              <div className="field">
                <label htmlFor="ksid">快手 ID</label>
                <div className="auth-input"><UserRound size={17} /><input id="ksid" autoComplete="username" value={kuaishouId} onChange={(event) => setKuaishouId(event.target.value)} placeholder="例如 MIAO_2025" /></div>
                <span className="field-hint">快手 ID 是你的唯一登录标识</span>
              </div>
              <div className="field">
                <label htmlFor="password">密码</label>
                <div className="auth-input">
                  <LockKeyhole size={17} />
                  <input id="password" autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} minLength={mode === "register" ? 8 : 6} placeholder={mode === "register" ? "至少 8 位密码" : "请输入密码"} />
                  <button type="button" className="toggle-password" aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
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
                {loading ? "请稍等..." : mode === "login" ? "进入剪辑团" : "创建账号"} <ArrowRight size={17} />
              </button>
            </form>
            {mode === "login" && <button className="forgot-password">忘记密码？联系管理员重置</button>}
            <div className="auth-security"><ShieldCheck size={15} /><span>你的积分和兑换记录会被好好保存</span></div>
          </div>
          <p className="auth-footer">© {new Date().getFullYear()} 妙妙剪辑团 · 仅限成员使用</p>
        </section>
      </div>
    </main>
  );
}

"use client";

import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AchievementData } from "./achievement-view";

function ratio(value: number, target: number) {
  return Math.min(100, Math.round((value / Math.max(target, 1)) * 100));
}

export function AchievementSummaryCard({ data, loading, error, onOpen, onRetry, onNeeded }: {
  data: AchievementData | null;
  loading: boolean;
  error: string;
  onOpen: () => void;
  onRetry: () => void;
  onNeeded: () => void;
}) {
  const anchor = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!anchor.current) return;
    if (!("IntersectionObserver" in window)) { onNeeded(); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { onNeeded(); observer.disconnect(); }
    }, { rootMargin: "150px 0px" });
    observer.observe(anchor.current);
    return () => observer.disconnect();
  }, [onNeeded]);
  if (loading) return <section ref={anchor} className="achievement-summary is-loading" aria-label="成长与成就正在加载"><span className="growth-loading-bar" /><small>正在整理你的成长档案…</small></section>;
  if (error) return <section ref={anchor} className="achievement-summary is-error" role="alert"><span>{error}</span><button onClick={onRetry}>重新加载</button></section>;
  if (!data) return null;
  const earned = data.achievements.filter((item) => item.earnedAt).length;
  const goalProgress = Math.min(ratio(data.goal.progress.videos, data.goal.targetVideos), ratio(data.goal.progress.engagement, data.goal.targetEngagement));
  return (
    <section ref={anchor} className="achievement-summary" aria-labelledby="achievement-summary-title">
      <Image src="/brand/miaomiao/growth/growth-hero.png" width={124} height={147} sizes="124px" alt="" className="achievement-summary-figure" />
      <div>
        <span className="journal-kicker">成长与成就</span>
        <h2 id="achievement-summary-title">Lv.{data.profile.level} · {data.profile.name}</h2>
        <p>{data.profile.experience.toLocaleString()} 经验 · 已点亮 {earned} 枚勋章 · 本月目标 {goalProgress}%</p>
      </div>
      <button onClick={onOpen} aria-label="查看成长与成就"><span>查看档案</span><ChevronRight size={19} /></button>
    </section>
  );
}


import { ArrowLeft, ChevronRight, Medal, Sparkles, Target, Trophy } from "lucide-react";

export type AchievementData = {
  profile: {
    experience: number;
    level: number;
    name: string;
    nextLevel: { level: number; name: string; minimumExperience: number } | null;
  };
  achievements: Array<{ code: string; title: string; description: string; earnedAt: string | null }>;
  goal: {
    monthStart: string;
    targetVideos: number;
    targetEngagement: number;
    baselineVideos: number;
    baselineEngagement: number;
    completedAt: string | null;
    progress: { videos: number; engagement: number };
  };
  highlights: Array<{
    id: string;
    sourceUrl: string;
    caption: string | null;
    coverUrl: string | null;
    likes: number | null;
    views: number | null;
    commentCount: number | null;
    submittedAt: string;
  }>;
  reviews: Array<{
    id: string;
    monthStart: string;
    approvedVideos: number;
    engagement: number;
    goalCompleted: boolean;
    baselineVideos: number;
    baselineEngagement: number;
    previousVideos: number;
    previousEngagement: number;
    highlightVideoId: string | null;
  }>;
};

function ratio(value: number, target: number) {
  return Math.min(100, Math.round((value / Math.max(target, 1)) * 100));
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long" }).format(new Date(value));
}

function number(value: number | null | undefined) {
  return (value ?? 0).toLocaleString();
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value.toLocaleString()}`;
}

export function AchievementSummaryCard({ data, loading, error, onOpen, onRetry }: {
  data: AchievementData | null;
  loading: boolean;
  error: string;
  onOpen: () => void;
  onRetry: () => void;
}) {
  if (loading) return <section className="achievement-summary is-loading" aria-label="成长与成就正在加载"><span className="growth-loading-bar" /><small>正在整理你的成长档案…</small></section>;
  if (error) return <section className="achievement-summary is-error" role="alert"><span>{error}</span><button onClick={onRetry}>重新加载</button></section>;
  if (!data) return null;
  const earned = data.achievements.filter((item) => item.earnedAt).length;
  const goalProgress = Math.min(ratio(data.goal.progress.videos, data.goal.targetVideos), ratio(data.goal.progress.engagement, data.goal.targetEngagement));
  return (
    <section className="achievement-summary" aria-labelledby="achievement-summary-title">
      <img src="/brand/miaomiao/growth/growth-hero.png" alt="" className="achievement-summary-figure" />
      <div>
        <span className="journal-kicker">成长与成就</span>
        <h2 id="achievement-summary-title">Lv.{data.profile.level} · {data.profile.name}</h2>
        <p>{data.profile.experience.toLocaleString()} 经验 · 已点亮 {earned} 枚勋章 · 本月目标 {goalProgress}%</p>
      </div>
      <button onClick={onOpen} aria-label="查看成长与成就"><span>查看档案</span><ChevronRight size={19} /></button>
    </section>
  );
}

export function AchievementView({ data, loading, error, onBack, onRetry }: {
  data: AchievementData | null;
  loading: boolean;
  error: string;
  onBack: () => void;
  onRetry: () => void;
}) {
  if (loading) return <div className="member-content journal-page achievement-page"><button className="page-back" onClick={onBack}><ArrowLeft size={19} />返回首页</button><section className="achievement-local-state"><span className="growth-loading-bar" /><p>正在打开成长档案…</p></section></div>;
  if (error || !data) return <div className="member-content journal-page achievement-page"><button className="page-back" onClick={onBack}><ArrowLeft size={19} />返回首页</button><section className="achievement-local-state is-error" role="alert"><p>{error || "成长档案暂时不可用"}</p><button className="journal-primary" onClick={onRetry}>重新加载</button></section></div>;
  const next = data.profile.nextLevel;
  const levelProgress = next ? ratio(data.profile.experience - (next.level === 1 ? 0 : [0, 500, 1500, 3500, 7000][next.level - 2] ?? 0), next.minimumExperience - ([0, 500, 1500, 3500, 7000][next.level - 2] ?? 0)) : 100;
  const recommendation = data.goal.completedAt ? "继续复用高互动选题，让下一支作品成为新的高光。" : data.goal.progress.videos < data.goal.targetVideos ? "先稳定完成一条通过作品，再集中优化互动表现。" : "作品数量已达标，下一步聚焦点赞、播放和评论互动。";
  return (
    <div className="member-content journal-page achievement-page">
      <button className="page-back" onClick={onBack}><ArrowLeft size={19} />返回首页</button>
      <section className="achievement-hero">
        <div><span className="journal-kicker">我的成长档案</span><h1>Lv.{data.profile.level} {data.profile.name}</h1><p>成长经验独立累计，不参与积分兑换或结算。</p></div>
        <img src="/brand/miaomiao/growth/growth-hero.png" alt="剪辑团成长档案插画" />
      </section>
      <section className="achievement-level-card">
        <div><span>累计成长经验</span><strong>{data.profile.experience.toLocaleString()}</strong></div>
        <div className="achievement-level-track"><i style={{ width: `${levelProgress}%` }} /></div>
        <small>{next ? `距离 Lv.${next.level} ${next.name} 还差 ${Math.max(0, next.minimumExperience - data.profile.experience).toLocaleString()} 经验` : "已达当前最高成长等级"}</small>
      </section>
      <section className="achievement-goal-card">
        <div className="achievement-section-title"><span><Target size={19} />{monthLabel(data.goal.monthStart)}目标</span><b className={data.goal.completedAt ? "is-done" : ""}>{data.goal.completedAt ? "已完成" : "进行中"}</b></div>
        <p>目标已按近 8 周表现锁定；作品和互动两个指标都要完成。</p>
        <div className="achievement-goal-grid">
          <div><span>通过作品</span><strong>{data.goal.progress.videos} / {data.goal.targetVideos}</strong><i><em style={{ width: `${ratio(data.goal.progress.videos, data.goal.targetVideos)}%` }} /></i></div>
          <div><span>互动值</span><strong>{data.goal.progress.engagement.toLocaleString()} / {data.goal.targetEngagement.toLocaleString()}</strong><i><em style={{ width: `${ratio(data.goal.progress.engagement, data.goal.targetEngagement)}%` }} /></i></div>
        </div>
      </section>
      <section className="achievement-section">
        <div className="journal-section-heading ruled"><h2>勋章墙</h2><span>{data.achievements.filter((item) => item.earnedAt).length} / {data.achievements.length} 已点亮</span></div>
        <div className="achievement-badge-grid">
          {data.achievements.map((item) => <article className={item.earnedAt ? "is-earned" : ""} key={item.code}><img src="/brand/miaomiao/growth/achievement-badge.png" alt="" /><div><strong>{item.title}</strong><small>{item.earnedAt ? `获得于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(item.earnedAt))}` : item.description}</small></div></article>)}
        </div>
      </section>
      <section className="achievement-section">
        <div className="journal-section-heading ruled"><h2>我的高光作品</h2><span>按互动表现精选</span></div>
        {data.highlights.length ? <div className="achievement-highlight-grid">{data.highlights.map((video) => {
          const cover = video.coverUrl && /^https:\/\//i.test(video.coverUrl) ? video.coverUrl : null;
          return <a href={video.sourceUrl} target="_blank" rel="noreferrer" key={video.id} className="achievement-highlight-card">{cover ? <img src={cover} alt="" /> : <div className="achievement-highlight-empty"><Medal size={25} /></div>}<div><strong>{video.caption || "一支精彩切片"}</strong><small>{number(video.likes)} 赞 · {number(video.views)} 播放 · {number(video.commentCount)} 评论</small></div></a>;
        })}</div> : <div className="achievement-empty"><img src="/brand/miaomiao/growth/achievement-badge.png" alt="" /><p>通过第一条作品后，这里会收藏你的高光。</p></div>}
      </section>
      <section className="achievement-review-card">
        <div><span className="journal-kicker">成长教练 · 月度复盘</span><h2><Sparkles size={20} />下一步建议</h2><p>{recommendation}</p></div>
        {data.reviews[0] ? <aside><strong>{monthLabel(data.reviews[0].monthStart)}</strong><span>{data.reviews[0].approvedVideos} 条通过 · {data.reviews[0].engagement.toLocaleString()} 互动值</span><span>较上月 {signed(data.reviews[0].approvedVideos - data.reviews[0].previousVideos)} 条 · 较 8 周基线 {signed(data.reviews[0].approvedVideos - data.reviews[0].baselineVideos)} 条</span><b>{data.reviews[0].goalCompleted ? "目标完成" : "继续积累"}</b></aside> : <aside><Trophy size={24} /><span>上月结束后，会在这里留下你的第一份复盘。</span></aside>}
      </section>
    </div>
  );
}

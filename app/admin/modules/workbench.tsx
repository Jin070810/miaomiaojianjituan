"use client";

import { AlertTriangle, ArrowRight, ClipboardCheck, KeyRound, PackageCheck, RefreshCw, Settings2, Sparkles, Users } from "lucide-react";
import { useEffect, useState } from "react";

type Queue = { id: string; label: string; count: number; section?: string; filter?: string; href?: string; tone: string };
type Workbench = {
  range: "7d" | "30d";
  timezone: string;
  metrics: {
    activeMembers: number;
    approvedVideos: number;
    approvedLikes: number;
    videoPoints: number;
    netPointChange: number;
    createdOrders: number;
    fulfilledOrders: number;
    lowStockGifts: number;
    currentWeek: { submitters: number; approvedSubmitters: number; approvedVideos: number };
  };
  queues: Queue[];
  trends: Array<{ label: string; approvedVideos: number; videoPoints: number; refunds: number; fulfilledOrders: number }>;
  risks: { lowStockGifts: number; disabledSwitches: Array<{ key: string; label: string }> };
};

const queueIcon = { appeals: ClipboardCheck, orders: PackageCheck, "password-resets": KeyRound, "challenge-failures": Sparkles, "disabled-switches": Settings2 };

function WorkbenchMetric({ label, value, description, icon: Icon }: { label: string; value: number; description: string; icon: typeof Users }) {
  return <article className="admin-stat-card workbench-metric"><div className="admin-stat-icon teal"><Icon size={19} /></div><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{description}</small></article>;
}

export function WorkbenchAdmin({ onNavigate }: { onNavigate: (section: string, filter?: string) => void }) {
  const [range, setRange] = useState<"7d" | "30d">("7d");
  const [data, setData] = useState<Workbench | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/workbench?range=${range}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "运营工作台加载失败");
      setData(result);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "运营工作台加载失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [range]);
  const max = Math.max(1, ...(data?.trends.flatMap((item) => [item.approvedVideos, item.fulfilledOrders]) ?? [1]));
  return <>
    <div className="admin-page-title workbench-title"><div><span className="eyebrow">OPERATIONS WORKBENCH</span><h1>运营工作台</h1><p>优先处理成员权益与系统风险；所有数据按 {data?.timezone ?? "Asia/Shanghai"} 汇总。</p></div><div className="workbench-toolbar"><div className="admin-tabs compact-tabs"><button className={range === "7d" ? "active" : ""} onClick={() => setRange("7d")}>近 7 天</button><button className={range === "30d" ? "active" : ""} onClick={() => setRange("30d")}>近 30 天</button></div><button className="secondary-button" disabled={loading} onClick={() => void load()}><RefreshCw size={16} />刷新</button></div></div>
    {loading && !data ? <section className="admin-module-state" role="status"><RefreshCw size={24} /><strong>正在汇总运营数据...</strong></section> : error ? <section className="admin-module-state" role="alert"><AlertTriangle size={24} /><strong>{error}</strong><button className="primary-button" onClick={() => void load()}>重新加载</button></section> : data && <>
      <section className="workbench-queue-grid" aria-label="运营待办">
        {data.queues.map((queue) => { const Icon = queueIcon[queue.id as keyof typeof queueIcon] ?? AlertTriangle; const content = <><span className={`workbench-queue-icon ${queue.tone}`}><Icon size={18} /></span><span><strong>{queue.label}</strong><small>{queue.count ? `待处理 ${queue.count.toLocaleString()} 项` : "当前无需处理"}</small></span><b>{queue.count.toLocaleString()}</b><ArrowRight size={16} /></>; return queue.href ? <a className="workbench-queue" key={queue.id} href={queue.href}>{content}</a> : <button className="workbench-queue" key={queue.id} onClick={() => onNavigate(queue.section ?? "workbench", queue.filter)}>{content}</button>; })}
      </section>
      <section className="admin-stat-grid workbench-stat-grid">
        <WorkbenchMetric label="有效成员" value={data.metrics.activeMembers} description="当前有效普通成员与审核员" icon={Users} />
        <WorkbenchMetric label="已通过切片" value={data.metrics.approvedVideos} description={`累计 ${data.metrics.approvedLikes.toLocaleString()} 赞`} icon={ClipboardCheck} />
        <WorkbenchMetric label="视频积分" value={data.metrics.videoPoints} description={`净变动 ${data.metrics.netPointChange >= 0 ? "+" : ""}${data.metrics.netPointChange.toLocaleString()} 分`} icon={Sparkles} />
        <WorkbenchMetric label="已履约订单" value={data.metrics.fulfilledOrders} description={`期间新增 ${data.metrics.createdOrders.toLocaleString()} 单`} icon={PackageCheck} />
      </section>
      <div className="admin-dashboard-grid">
        <section className="admin-panel chart-panel workbench-trend"><div className="admin-panel-head"><div><h2>运营趋势</h2><p>通过切片与已履约订单；柱高按当前所选周期相对计算。</p></div></div><div className="workbench-bars">{data.trends.map((item) => <div key={item.label}><div className="workbench-bar-stack"><i style={{ height: `${Math.max(item.approvedVideos ? 12 : 0, item.approvedVideos / max * 148)}px` }} title={`${item.approvedVideos} 条通过切片`} /><b style={{ height: `${Math.max(item.fulfilledOrders ? 10 : 0, item.fulfilledOrders / max * 148)}px` }} title={`${item.fulfilledOrders} 单已履约`} /></div><small>{item.label}</small></div>)}</div><div className="chart-legend"><span><i className="legend-dot coral-dot" />通过切片</span><span><i className="legend-dot teal-dot" />已履约订单</span></div></section>
        <section className="admin-panel exception-panel"><div className="admin-panel-head"><div><h2>需要关注</h2><p>库存和运营入口风险</p></div><AlertTriangle size={19} color="#b8750a" /></div><div className="exception-list"><div><span className="exception-icon warning"><PackageCheck size={16} /></span><div><strong>低库存礼品</strong><small>库存不高于 3 件的在架商品</small></div><b>{data.risks.lowStockGifts}</b></div><div><span className="exception-icon danger"><Settings2 size={16} /></span><div><strong>已关闭入口</strong><small>{data.risks.disabledSwitches.map((item) => item.label).join("、") || "所有运营入口已开启"}</small></div><b>{data.risks.disabledSwitches.length}</b></div></div><button className="secondary-button full-button" onClick={() => onNavigate("settings")}>查看运营设置 <ArrowRight size={16} /></button></section>
      </div>
      <section className="admin-panel member-growth-panel"><div className="admin-panel-head"><div><h2>本周成员参与</h2><p>按上海时间周一 00:00 起计算，仅用于运营观察。</p></div></div><div className="member-growth-admin-grid"><div><span>提交人数</span><strong>{data.metrics.currentWeek.submitters.toLocaleString()}</strong></div><div><span>通过人数</span><strong>{data.metrics.currentWeek.approvedSubmitters.toLocaleString()}</strong></div><div><span>通过切片</span><strong>{data.metrics.currentWeek.approvedVideos.toLocaleString()}</strong></div><div><span>低库存礼品</span><strong>{data.metrics.lowStockGifts.toLocaleString()}</strong></div></div></section>
    </>}
  </>;
}

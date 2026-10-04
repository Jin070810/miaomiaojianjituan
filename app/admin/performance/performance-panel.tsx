"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PerformanceSnapshot } from "@/lib/performance-store";
import type { getDatabasePressure } from "@/lib/database-performance";
import type { PercentileInterval } from "@/lib/performance-metric-model";
import styles from "./performance.module.css";

function interval(value: PercentileInterval | null, unit: string) {
  if (!value) return "暂无数据";
  return value.upper === null ? "> " + value.lower + " " + unit : value.lower + "–" + value.upper + " " + unit;
}
export function PerformancePanel() {
  const [data, setData] = useState<(PerformanceSnapshot & { database?: Awaited<ReturnType<typeof getDatabasePressure>> }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true); setError("");
    const timer = setTimeout(() => abort.abort(), 5000);
    try {
      const response = await fetch("/api/admin/performance", { cache: "no-store", signal: abort.signal });
      if (!response.ok) throw new Error(response.status === 403 ? "当前账号没有查看权限" : "性能数据暂时无法加载");
      const body = await response.json() as PerformanceSnapshot;
      if (!Array.isArray(body.rows) || !body.resources || !["ok", "unavailable", "not-configured"].includes(body.status)) throw new Error("性能数据格式不完整");
      if (generation.current === current) setData(body);
    } catch (cause) {
      if (generation.current === current) setError(abort.signal.aborted ? "加载超时，请重试" : cause instanceof Error ? cause.message : "加载失败，请重试");
    } finally { clearTimeout(timer); if (generation.current === current) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); return () => { generation.current++; controller.current?.abort(); }; }, [refresh]);
  return <main className={styles.page}>
    <header className={styles.header}><div><Link className={styles.back} href="/admin">← 返回管理后台</Link><h1>性能观测</h1><p>接口、页面体验与任务等待，帮助定位变慢的环节。</p></div>
      <button onClick={() => void refresh()} disabled={loading}>{loading ? "正在加载…" : "刷新数据"}</button>
    </header>
    {loading && <p role="status">正在读取性能数据…</p>}
    {error && <p className={styles.error} role="alert">{error}{data && "；下方保留上次结果。"}</p>}
    {data && <>
      {data.status !== "ok" && <p className={styles.error} role="alert">观测存储{data.status === "not-configured" ? "尚未配置" : "暂时不可用"}，当前无法判断性能。</p>}
      <p className={styles.note}>统计窗口：{new Date(data.windowStart).toLocaleString("zh-CN")} 至 {new Date(data.windowEnd).toLocaleString("zh-CN")}。分位数为区间估计；样本少于 100 条时请谨慎比较。</p>
      {(["api", "rum", "database", "queue"] as const).map((kind) => <section key={kind} aria-label={kind === "api" ? "接口耗时" : kind === "rum" ? "页面体验" : kind === "database" ? "数据库查询" : "任务等待"}>
        <h2>{kind === "api" ? "接口耗时" : kind === "rum" ? "页面体验" : kind === "database" ? "数据库查询" : "任务等待"}</h2>
        <p className={styles.note}>{kind === "api" ? "包含登录与业务处理；5xx 比例仅统计服务器错误，4xx 业务拒绝不计入。" : kind === "rum" ? "随机抽样约 20% 的页面加载，无账号或 URL 明细。客户端上报仅供趋势参考；部分浏览器不支持全部指标。" : kind === "database" ? "随机抽样约 10% 的查询往返耗时，仅保留查询类别；包括网络与数据库等待，不等同于 SQL 执行时间，也不代表完整事务耗时。" : "首次入队至本次执行开始的时间，包含重试与计划延迟；尚未被消费的任务不在这些样本中。"}</p>
        <div className={styles.cards}>{data.rows.filter((row) => row.kind === kind).map((row) => <article key={row.key} className={styles.card}>
          <h3>{row.label}</h3><p className={styles.samples}>{row.count.toLocaleString()} 条样本{row.count < 100 ? " · 样本较少" : ""}</p>
          <dl><div><dt>{kind === "rum" ? "p75" : "p95"}</dt><dd>{interval(kind === "rum" ? row.p75 : row.p95, row.unit)}</dd></div>
            <div><dt>p50</dt><dd>{interval(row.p50, row.unit)}</dd></div>
            {kind === "api" && <div><dt>5xx 比例</dt><dd>{row.errorRate === null ? "暂无数据" : (row.errorRate * 100).toFixed(1) + "%"}</dd></div>}
          </dl>
        </article>)}</div>
        {!data.rows.some((row) => row.kind === kind) && <p className={styles.empty}>暂无{kind === "api" ? "接口" : kind === "rum" ? "页面体验" : kind === "database" ? "数据库查询" : "任务等待"}样本</p>}
      </section>)}
      <section aria-label="队列现状"><h2>队列现状</h2><p className={styles.note}>队首年龄为下一个普通 FIFO 任务距首次入队的时间，不代表重试、优先级或延迟任务中的最老任务。</p>
        <div className={styles.cards}>{(["video", "weekly"] as const).map((key) => {
          const queue = data.queues?.[key];
          return <article key={key} className={styles.card}><h3>{key === "video" ? "视频队列" : "周挑战队列"}</h3>{queue ? <dl>
            <div><dt>等待 / 执行</dt><dd>{queue.waiting} / {queue.active}</dd></div>
            <div><dt>延迟 / 暂停 / 优先级</dt><dd>{queue.delayed} / {queue.paused} / {queue.prioritized}</dd></div>
            <div><dt>队首年龄</dt><dd>{queue.headAgeMs === null ? "无可用时间" : (queue.headAgeMs / 1000).toFixed(1) + " 秒"}</dd></div>
          </dl> : <p>队列数据暂不可用</p>}</article>;
        })}</div>
      </section>
      <section aria-label="数据库现状"><h2>数据库现状</h2><p className={styles.note}>仅本数据库、当前应用账号的连接；排除探测本身。不读取 SQL 文本或参数。</p>
        {data.database ? <div className={styles.cards}><article className={styles.card}><h3>活动查询与事务</h3><dl>
          <div><dt>活动查询</dt><dd>{data.database.active}</dd></div><div><dt>锁等待连接</dt><dd>{data.database.lockWaiting}</dd></div>
          <div><dt>超过 60 秒的事务</dt><dd>{data.database.longTransactions}</dd></div>
          <div><dt>最长当前事务</dt><dd>{data.database.oldestTransactionSeconds === null ? "无活动事务" : data.database.oldestTransactionSeconds.toFixed(1) + " 秒"}</dd></div>
        </dl></article></div> : <p className={styles.empty}>数据库观测暂不可用</p>}
      </section>
      <section aria-label="进程资源"><h2>进程资源</h2><p className={styles.note}>最近 60 秒内的 Node.js 进程采样；CPU 为两次采样间平均值，100% 代表一个 CPU 核心。不包含 Chromium、数据库或整个宿主机。磁盘为应用目录所在文件系统，不包含独立数据库或备份挂载。</p>
        <div className={styles.cards}>{(["web", "worker"] as const).map((role) => {
          const resource = data.resources[role];
          return <article key={role} className={styles.card}><h3>{role === "web" ? "Web" : "Worker"}</h3>{resource ? <dl>
            <div><dt>内存 RSS</dt><dd>{(resource.rssBytes / 1048576).toFixed(1)} MiB</dd></div>
            <div><dt>CPU</dt><dd>{resource.cpuPercent === null ? "等待第二次采样" : resource.cpuPercent.toFixed(1) + "%"}</dd></div>
            <div><dt>应用文件系统可用</dt><dd>{resource.diskAvailableBytes == null ? "暂无数据" : (resource.diskAvailableBytes / 1073741824).toFixed(1) + " GiB"}</dd></div>
            <div><dt>采样时间</dt><dd>{new Date(resource.at).toLocaleTimeString("zh-CN")}</dd></div>
          </dl> : <p>暂无新鲜采样</p>}</article>;
        })}</div>
      </section>
      <p className={styles.note}>当前 Web 进程因存储不可用或并发上限丢弃 {data.droppedInThisProcess} 次观测操作。统计保留 72 小时，页面展示当前小时及之前 23 小时；重启可能清除本进程丢弃计数。</p>
    </>}
  </main>;
}

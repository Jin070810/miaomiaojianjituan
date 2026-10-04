# 性能观测与诊断

## 能看到什么

管理员入口：后台菜单 → 性能观测（`/admin/performance`）。服务端同时检查页面和数据接口的 ADMIN 权限，接口不缓存。普通成员与未登录请求返回 403。

| 数据 | 范围与含义 | 边界 |
| --- | --- | --- |
| API p50 / p95 | 登录、身份、首页、礼品、成长、成就、排行、周挑战、视频列表/提交、转账、兑换列表/提交、管理概览共 14 个固定操作 | 服务端 handler 时间；不是浏览器往返时间。5xx 单列，业务 4xx 不计作服务器错误 |
| 页面 p75 / p50 | TTFB、FCP、LCP、INP、CLS；页面加载约 20% 随机抽样 | 固定登录/成员/管理/其他与移动/桌面分类；不覆盖每次 SPA 切页，浏览器不支持或未触发的指标没有样本 |
| 数据库 p50 / p95 | Prisma query event 按 SELECT、写查询、其他查询约 10% 随机抽样 | 客户端发查询到收到响应，包含网络/等待，不是纯 SQL 执行时间；排除 BEGIN/COMMIT/ROLLBACK，不冒充完整事务持续时间 |
| 数据库当前压力 | 当前数据库、当前应用账号的活动查询、锁等待、超过 60 秒的事务和最长当前事务 | 排除探测自身；750ms SQL 超时、500ms 获取连接上限、1500ms 事务上限。失败显示未知；不读取查询内容 |
| 视频/周挑战等待分布 | 任务首次入队至本次 attempt 开始的年龄 | 包含延迟和重试；尚未消费的任务不会进入分布，不等同于纯 FIFO 等待 |
| 队列现状 | waiting/active/delayed/paused/prioritized 数量及普通 FIFO 队首年龄 | 只读固定 BullMQ 5 list/zset 与一个任务 timestamp；不遍历任务、不返回任务 ID/负载。队首不一定是所有重试/优先级任务中的最老任务 |
| Web/Worker 资源 | Node RSS、heap、两次采样之间平均 CPU、进程 uptime、应用文件系统可用空间 | 每角色最近一次采样，60 秒过期；并非所有副本汇总，不包含 Chromium 子进程/宿主机 CPU/其他磁盘挂载 |

样本不足 100 条时界面提示谨慎比较。p50/p75/p95 返回直方图区间，不返回虚构的精确分位数。上溢区间显示“> 阈值”，空数据是未知，不是零。API/查询/普通页面耗时最多按 10 分钟计，CLS 上限 100，任务年龄最多按 7 天计；长尾上溢区间仍保留。

Redis 按 UTC 小时聚合，页面读取当前小时和此前 23 小时。小时 key 最后写入后 72 小时过期；边界上可能跨 73 个小时。总共只有 59 个预定义序列，不能通过成员 ID、URL、查询参数或任意标签扩张。统计不进入 PostgreSQL 业务表，不需要 migration。

## 不影响业务的采集路径

- API 响应保留原状态、响应体和业务异常。添加服务端 UUID `x-request-id` 与 `Server-Timing: app;dur=...`，Redis 写入安排到 Next.js `after()`。
- 查询事件和 Worker 采集为非阻塞 best effort；采集失败不改变积分、事务提交或视频状态。
- 独立 Redis 连接遵守完整 REDIS_URL；无离线排队、无自动重试，连接/命令各 350ms，单次操作总上限 800ms，最多 8 个并发操作，失败后熔断 30 秒。空闲 1 秒断开，避免导入 Prisma 的维护脚本被空闲采集连接挂住。
- 高压或故障时允许丢样本。面板显示当前 Web 模块的丢弃操作数，重启会清零；它不是全站完整丢弃计数。丢样本可能带来采样偏差，应结合错误告警与原始阶段日志判断。
- Web 资源由请求触发，至少间隔 15 秒；Worker 随 15 秒心跳采样。空闲 Web/停止 Worker 没有新鲜采样时明确显示未知。
- 面板手动刷新，无持续轮询；5 秒超时，可重试，刷新失败保留上次结果。

## 隐私与真实性

页面上报仅接受 `name/page/viewport/value` 四个字段；拒绝多余字段、任意标签、非数值/负值/无穷值。只允许同源 JSON，请求体实际读取上限 1KiB、读取时间上限 500ms，Redis 全局每分钟最多接受 3000 个有效样本。客户端用 `credentials: "omit"` 和 keepalive，不发送 Session Cookie，不发送账号、IP、DOM、原始 URL、查询参数、手机号、地址或表单内容。

RUM 是客户端可伪造的参考数据，同源校验不等同于真实性证明；不得作为积分、风控或独立发布门禁。没有外部统计供应商。Redis 数值与采样时间也不含成员维度。

Prisma 只启用 query 的 event 输出，监听器丢弃 SQL 文本和参数，仅保留固定类别与 duration。慢 API/5xx 日志每进程每分钟最多 60 条，仅包含路由固定标签、状态码、耗时、服务端请求 ID；不会加入请求体、Cookie 或错误详情。

## 请求关联

`AsyncLocalStorage` 隔离并发请求。原来调用 `security.requestId()` 的登录审计自动使用响应中的 UUID；已有幂等键的业务含义不变。

新视频提交审计 `afterValue.traceId` 保存 Web UUID，BullMQ job data 带同一 `requestId`；自动通过/驳回的审计 requestId、完成日志和失败告警带上该关联。Worker 只接受 UUID v4 形式的 job requestId；旧任务没有该字段时使用新的执行关联，不能伪称已恢复历史 Web 请求链路。恢复机制创建的新任务也可能得到新关联，仍用已有 video ID 连接历史。

SQL 事件没有可靠的逐请求异步上下文，当前不为 SQL 伪造 request ID；应先按时间窗定位慢接口，再在脱敏副本上检查相应查询计划。完整事务的历史耗时、宿主机所有磁盘及 Chromium 全进程树仍需主机监控/专用 tracing，当前面板不声称覆盖这些数据。

## 推荐诊断顺序

1. 固定时间窗、相同视口与网络比较；先看样本量、采集是否可用、错误率。
2. 页面 LCP 高而 API 正常：检查图片/字体资源与网络；页面 TTFB 高而 handler 正常：检查代理、网络与服务排队。
3. API 与数据库查询同时变慢：看锁等待、长事务、资源，再在脱敏副本执行实际查询计划。不要依据一个聚合分位数盲加索引。
4. waiting 增长/队首年龄升高且 Worker 采样消失：结合 Worker 心跳、累计尝试数及终止状态检查恢复链路；不要无限重投。
5. 发布用 release journal 各阶段时间判定耗时；健康接口成功不能代替登录、提交、兑换验收。

## 集成与回滚

- 与 #106 的 Worker 生命周期/完整 Redis URL 连接合并；本分支在非默认 Redis DB 上的观测遵守 URL，历史队列连接缺失 DB 的缺陷由 #106 修复。不要将两种 DB 的统计作对比。
- 与 #109/#117/#118 的制品发布、#114 的健康边界、#115/#116 的读取路径一起做集成验收；#123 的新增绑定已移出本次范围；此分支不会改变业务积分公式。
- Worker 运行依赖仅增加已有 ioredis 与 Node 内置模块，不引入 Next.js 到 Worker。
- 回退应用即可停用采集；新增 Redis key 自动过期，不影响队列数据和账本。可公开图片与其他任务的 migration 不属于本分支回滚范围。

## 已执行验证

- 固定标签/隐私边界、分位区间、挂起 Redis 的 800ms 上限与熔断、并发初始连接、API 响应与审计 ID 隔离、不可变重定向、RBAC/同源/实际 body 上限。
- 真实 PostgreSQL 锁等待与自动入账审计关联；真实 Redis 写读直方图、真实 BullMQ FIFO/暂停状态且不泄露任务内容。
- 两种视口真实登录 → API/Redis 统计 → 管理面板；验证匿名 RUM 无 Cookie、权限拒绝、加载/禁用、错误重试、空数据和不可用状态。
- 合成截图和采样 JSON 保存在工作区外，CI 上传到 Playwright / staging 证据产物。这里的性能数值全部来自合成环境，不是生产基线。
- 最终命令数量与 CI 结果见本 PR 验证清单；须完成集成 staging、自动发版门禁与正式发布记录，不要求维护者逐次自审。

实现参考：[Next.js useReportWebVitals](https://nextjs.org/docs/app/api-reference/functions/use-report-web-vitals)、[Next.js after](https://nextjs.org/docs/app/api-reference/functions/after)、[Prisma 6 QueryEvent 定义](https://docs.prisma.io/docs/orm/v6/reference/prisma-client-reference)。使用仓库锁定的 Next.js 16 / Prisma 6 / BullMQ 5 源码与实际测试验证兼容性。

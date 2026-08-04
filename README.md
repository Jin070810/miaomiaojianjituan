# 妙妙剪辑团积分中心

这是“妙妙剪辑团积分中心”的可部署版本，包含成员端、管理员端、认证、成员头像、积分账户、视频审核、转账、积分商城、榜单结算、AI 周挑战和生产运维工具。

## 本地运行

1. 安装依赖：`npm install`
2. 复制 `.env.example` 为 `.env`，设置 `DATABASE_URL`、`SESSION_SECRET` 和 32 字节的 `PHONE_ENCRYPTION_KEY`。
3. 启动 PostgreSQL 与 Redis：`docker compose up -d postgres redis`
4. 初始化数据库：`npm run db:deploy`
5. 先检查飞书数据：`npm run feishu:inspect`
6. 业务负责人逐项确认冲突报告后，显式批准才执行迁移：`npm run feishu:migrate -- --apply --allow-conflicts`
7. 飞书商品图是附件而不是 URL；迁移完成后执行 `npm run feishu:gifts`，它会从飞书下载附件到 `public/gifts/feishu`，并把礼品图片路径写入数据库。脚本可重复执行，不会重复下载或重复审计。
8. 设置 `ADMIN_KUAISHOU_IDS`；首次创建管理员时同时通过环境变量设置 `ADMIN_PASSWORD`（可选 `ADMIN_NICKNAME`），执行 `npm run seed:admin`。密码只通过部署环境注入，不写入仓库或日志。
9. 启动 Web：`npm run dev`
10. 启动抓取 Worker：`npm run worker`

完整 Docker 部署可使用 `docker compose up -d`。`migrate` 服务会等待 PostgreSQL 健康后执行版本化的 `prisma migrate deploy`。

生产环境准备证书到 `certs/fullchain.pem` 和 `certs/privkey.pem` 后，使用 `docker compose --profile production up -d` 启动 Nginx HTTPS 入口。

Linux 服务器使用 `bash scripts/backup-db.sh backups .env.production` 备份，恢复使用 `bash scripts/restore-db.sh <备份文件> .env.production`；Windows 运维可使用对应的 `.ps1` 脚本。生产默认 `BACKUP_STORAGE_MODE=local`，每日生成并校验 SHA-256、保留 7 天；OSS 保留为显式可选模式，不配置时不要求 Bucket 或密钥。零成本方案的本地 dump 与服务器同盘，发布前还必须创建轻量应用服务器免费快照作为回滚点。详见 [`docs/OSS-BACKUP-RUNBOOK.md`](docs/OSS-BACKUP-RUNBOOK.md)。

新服务器首次准备可由 root 执行 `bash scripts/bootstrap-server.sh`，它会安装 Docker/Compose、配置 2GB Swap、限制入站端口并创建 `/opt/miaomiaojianjituan`。正式 workflow 会在备份和启动容器前执行 `bash scripts/production-preflight.sh`，检查生产密钥、非默认数据库密码、Docker Compose 和 HTTPS 证书。

正式发布由 GitHub Actions 校验已合并的 release commit，再通过专用部署账号让生产服务器拉取该 commit，并利用本机 Docker/BuildKit 缓存构建 App/Worker 镜像。构建成功后才生成发布前备份、执行 migration、切换 Web/Worker 并刷新 Nginx。该流程不再通过低带宽 SSH 链路传输完整镜像；详细设计和耗时目标见 [`docs/RELEASE-PIPELINE.md`](docs/RELEASE-PIPELINE.md)。

## 快手视频抓取

成员可以粘贴短链接、长链接或包含链接的分享文本。服务端只接受 `kuaishou.com` 域名，Worker 使用参数数组调用 `curl -sS -L -A "Mozilla/5.0" --max-time 10`，从页面源码解析 `likeCount`、`viewCount`、`photoId` 和 `userName`。

作者名会先做 NFKC 规范化、去除 emoji/符号、团名标记和常见装饰差异，再按双向包含、团名别名和有限编辑距离判断。匹配成功会自动入账并进入二次审核池；作者不一致、低赞、超期、重复、字段缺失或链接失效都会自动驳回，不进入普通人工队列。快手页面抓取使用 5 次递增退避，耗尽后才判定链接不可用。

机审通过后成员端仍显示已到账；系统会把新通过视频平均分配给启用中的审核员二审。审核员可从“视频二次审核台”直接打开视频链接核查，二审通过只关闭任务，二审驳回会在同一事务内撤销视频、扣回已发积分、写审计日志、发通知并联动周挑战和成长记录重算。没有启用审核员时任务保持未分配，由管理员在后台二审池接管。

成员可对自动驳回记录提交一次待处理申诉；只有申诉进入管理员复查。申诉通过时管理员可以确认或修改整数积分，视频入账、申诉状态和审计日志在同一事务完成。

视频提交规则：

- 只结算提交时发布时间不超过 7 天、点赞量至少 200 的视频。
- 200–1000 赞兑换 50 积分；超过 1000 赞按 `floor(点赞量 / 2)` 计算，最高 5000 积分。
- `photoId` 对处理中、待审核和已通过记录全局唯一，同一视频不能重复结算。
- 已驳回记录不占用唯一约束，修正问题后可以重新提交。
- 新规则只影响后续抓取和申诉处理，不自动重算历史已到账积分；二次审核池也只接收上线后的新机审通过视频。上线前可用 `npm run video:audit-approved` 只读复查样本，使用 `npm run video:reprocess-pending -- --apply` 批量重抓旧的失败/历史待审核记录。

## 榜单与领奖

- 周更新排行榜：按当周提交且通过的视频数量排序。
- 月点赞量排行榜：按当月提交且通过视频在提交时抓取的点赞量总和排序。
- 总积分排行榜：按成员当前可用积分排序。
- Worker 不再自动补结算周榜/月榜；管理员从后台选择已结束周期，预览前五名并显式确认结算。
- 商城商品具有真实分类与最多 6 个标签；已有商品会在 migration 中按名称归入实用好物、零食饮品、潮玩周边、数码设备、特别体验、重磅大奖、会员权益或现金福利，管理员仍可手工调整。
- 现金商城礼品必须填写收款码；实物商城礼品和周/月榜奖励统一收集收货姓名、手机号和详细地址，榜单奖励不依赖商城礼品目录。
- “会员权益”用于爱奇艺、腾讯视频、剪映、Adobe 等视频、剪辑和办公软件会员。管理员可为商品配置最多 8 个兑换字段；成员提交的账号、手机或邮箱等资料会加密保存，只在管理员处理对应订单时解密展示。
- 收款码和收货档案可保存复用；手机号和地址加密存储，管理员后台按权限解密查看。
- 兑换提交时在同一事务内校验积分和库存，成功后实物订单进入“已下单，待采购”，现金订单进入“待发放”；管理员可发货时选填快递单号，或驳回并原路退回积分与库存。
- 实物订单发货后成员可查看发货时间和快递单号；管理员可以补充或修正单号，订单状态、物流信息、通知和审计记录保持一致。

榜单结算按 Asia/Shanghai 的周一 00:00 和每月 1 日边界计算。结算时保存第 1–5 名奖励名称/说明快照，所有有效普通成员收到一条榜单通知，获奖成员收到填写收货信息入口；成员提交后状态为 `CLAIMED`，管理员完成发放后状态为 `FULFILLED` 并再次发送通知。手机号和地址仍复用加密收货档案。

## 通知与公告

- 成员端通知中心汇聚公告、视频结果、申诉、转账、兑换、发货、退款和积分变化；通知按用户归属并使用去重键，业务状态、积分流水、审计和通知在同一事务内提交。
- 管理员可以保存草稿，向发布时的全体有效普通成员或 1–200 名定向成员发布纯文本公告。已发布公告不可编辑，撤回会隐藏成员端正文并关闭未读提醒。
- 成员首次登录会话最多弹出 10 条最新未读通知；关闭不会标记已读，打开通知详情或使用“全部已读”才会更新状态。铃铛未读数每 30 秒及页面重新获得焦点刷新。
- 通知包含业务对象时提供“查看详情”入口，成员会直接进入对应的视频、兑换、转账或积分流水页面。

## v1.2.1 稳定性增强

- 管理后台“系统设置”提供视频提交、积分转账和礼品兑换三个服务端运营开关；关闭入口不影响后台处理已有数据。
- 告警支持二选一或同时配置：`ALERT_WEBHOOK_URL` 接入外部 HTTP 系统；或者使用 `ALERT_EMAIL_TO`、`ALERT_SMTP_HOST`、`ALERT_SMTP_USER`、`ALERT_SMTP_PASSWORD` 配置 SMTP 邮件。Worker 失败、Redis/Worker 不可用、队列滞留、每日对账异常和备份异常都会发送递归脱敏后的告警。163 邮箱使用 `smtp.163.com:465`、`ALERT_SMTP_SECURE=true`，密码必须填写客户端授权码而不是网页登录密码。
- 每日巡检执行 `npm run ops:daily-check`，备份校验执行 `npm run ops:verify-backups`；建议由 cron/任务计划程序运行并保留输出。
- 管理后台系统设置可导出订单、积分、视频和审计四类脱敏 CSV；CSV 已防止公式注入，手机号、地址、收款码、密码和原始抓取 payload 不导出。

本阶段 migration 为 `prisma/migrations/20260724010000_notifications_announcements`，只新增通知、公告及收件人表。回滚应用版本时保留这些表和历史通知，不删除已执行 migration；如需停用功能，应以前向修复或配置关闭入口。

## v1.3 AI 个性化周挑战

- Worker 使用 BullMQ 持久调度器在周日 18:00（`Asia/Shanghai`）冻结下一周 audience，并由周期巡检补齐丢失、失败或租约过期的生成任务；队列任务三次指数退避，重复入队按周期去重。
- 只有上周提交过非失败视频的成员才进入 audience。每批最多处理 8 名匿名成员；DeepSeek 只接收匿名引用、最近两周聚合数据和服务端确定的目标，不接收昵称、快手 ID、手机号、地址、余额或视频链接。
- 视频数、点赞数、基线、难度和三档整数奖励全部由服务端确定并校验，模型只返回 `memberRef`、标题、说明和原因。提示词版本为 `weekly-challenge-v5-deterministic-targets`，严格拒绝模型提供数值业务字段。
- 每批 AI 文案最多尝试三次；连续失败后改用已审核的稳定模板，仍在事务中完整发布并记录 `AI`、`HYBRID` 或 `DETERMINISTIC` 模式。已校验批次按输入哈希保存，Worker 重启或人工重试不会重复调用已完成批次。
- 周一自动激活；成员只查看自己的基线、进度、说明和奖励。个人奖励达标后主动领取，截止到下一周周三 23:59；固定 `2,000` 分竞速奖励在达标视频通过事务中抢占。
- 视频撤销会在同一事务内重新计算任务，必要时冲正个人与竞速积分，并把竞速奖励改发给仍达标且最早完成的成员。
- 管理后台可查看周期覆盖、预算、任务分布、模型批次和失败原因；“周挑战积分发放”开关默认关闭，关闭时保留只读查询。

本地或 staging 配置 `DEEPSEEK_BASE_URL`、`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`，并配置 Webhook 或完整 SMTP 邮件告警后再启用周挑战。测试使用本地模拟服务，不读取真实密钥。生产镜像还必须在构建时注入 `APP_COMMIT_SHA` 与 `APP_BUILD_TIME`；健康接口会返回 App/Worker 版本并拒绝版本不一致的部署。

真实 DeepSeek 上线验收必须使用全新的独立 PostgreSQL schema，名称以 `shadow_` 或 `staging_` 开头。先执行 migration，再设置 `WEEKLY_CHALLENGE_SHADOW_CONFIRM=I_UNDERSTAND_PAID_DEEPSEEK_SHADOW` 并运行 `npm run weekly:shadow`；脚本会生成 300 名纯合成匿名成员、回放五周聚合数据并连续生成两个挑战周期。SSE 默认使用 180 秒总时限、60 秒首字节时限、45 秒流空闲时限和 6,000 Token 输出上限；收到流进度会刷新空闲计时。影子验收要求两个周期均为纯 `AI`、零降级批次，报告记录 AI/模板尝试数、覆盖、预算、失败分类、延迟和 Token 聚合。脚本拒绝非空 schema 和 `public`，始终保持积分发放开关关闭。

合并到 `main` 后也可以手动运行 GitHub Actions 的 `Weekly Challenge DeepSeek Shadow` workflow。该任务只使用 Actions 临时 PostgreSQL 服务，不连接生产数据库；DeepSeek 与告警配置从 `production` Environment 注入，聚合报告作为 30 天 artifact 留存。

正式发布从 GitHub `production` Environment 读取 DeepSeek 配置，以及 Webhook Secret 或 SMTP Variables/Secrets，由部署 workflow 写入服务器环境文件。包含手机号的收件地址和 SMTP 发件账号也按 Secret 管理；`DEEPSEEK_API_KEY`、`ALERT_WEBHOOK_URL`、`ALERT_EMAIL_TO`、`ALERT_EMAIL_FROM`、`ALERT_SMTP_USER`、`ALERT_SMTP_PASSWORD` 禁止提交到仓库。

告警尚未配置时只允许使用部署 workflow 的 `confirm_alert_deferred` 显式受控灰度；workflow 会写入 `ALERTS_DEFERRED=true`，并把 `weeklyChallenges.enabled == false` 作为发布成功条件。该模式只能部署代码，不能启用周挑战或运行付费影子任务；补齐并验证告警后应恢复 `ALERTS_DEFERRED=false`。

韧性修复 migration 为 `prisma/migrations/20260804170000_weekly_challenge_resilience`，只新增生成来源/模式和检查点字段及索引。应用回滚时先关闭周挑战开关，再同时回退 Web/Worker；保留新增字段、任务和积分审计历史，不回退已执行 migration。完整验收见 [`docs/ACCEPTANCE-V1.3-WEEKLY-CHALLENGES.md`](docs/ACCEPTANCE-V1.3-WEEKLY-CHALLENGES.md)，事故分析见 [`docs/INCIDENT-20260802-WEEKLY-CHALLENGE.md`](docs/INCIDENT-20260802-WEEKLY-CHALLENGE.md)。

## 批量积分

- 管理后台支持一次选择一名或多名有效普通成员，也可以选择全体成员，以相同的整数积分和原因批量增减，不设置人数上限。
- 批量操作使用请求幂等键派生每名成员的积分流水和通知去重键；成员校验、余额条件扣减、流水、通知和审计在一个事务中完成。任一成员不存在、停用或余额不足，整批回滚。后台可直接选择全部有效普通成员，不按人数截断。
- 后台成员列表按 50 条分页；已勾选成员在继续加载后保持选择。“全部有效成员”由服务端在积分事务内重新解析，不受前端已加载页数影响。单成员 `POST /api/admin/points` 接口保持兼容。

## v1.4 稳定运营优化

- 成员视频提交支持完整分享文案和真实剪贴板读取，覆盖空剪贴板、权限拒绝、不支持、超长文案、提交中与接口失败反馈。
- 后台首屏只加载概览，各业务菜单切换时按需加载并缓存；模块失败提供局部重试，写操作只刷新相关数据和概览指标。
- 生产备份增加 OSS 上传、回下载校验、7 天本地保留和月度隔离恢复演练；每日执行时间为上海时间 02:15。
- 本版不增加周挑战预览字段或 migration，不改变现有周挑战 API。

首周值守见 [`docs/V1.4-FIRST-WEEK-OPERATIONS.md`](docs/V1.4-FIRST-WEEK-OPERATIONS.md)，验收和回滚见 [`docs/ACCEPTANCE-V1.4-STABLE-OPERATIONS.md`](docs/ACCEPTANCE-V1.4-STABLE-OPERATIONS.md)。

## v1.6 成员成长反馈

- 成员首页异步展示本周通过切片、点赞量和视频积分，以及相对上周同期的整数变化；成长接口失败不会阻塞首页，卡片可局部重试。
- 成长记录页展示最近 8 周趋势、本周与上周同期对比、本月点赞最高的 3 条已通过切片，并覆盖空数据、下降、持平和超大数字状态。
- 下一步建议按“领取挑战奖励 -> 处理异常切片 -> 继续周挑战 -> 提交本周第一条 -> 查看成长记录”的固定优先级生成，不引入额外积分奖励。
- 管理后台概览只读展示本周提交人数、通过人数、通过视频、点赞、视频积分及周挑战覆盖/达标/领取情况。
- 所有统计使用 `Asia/Shanghai` 周一 00:00 周界，按视频 `submittedAt` 归属，只统计 `APPROVED` 视频；本版不增加 migration，不改变积分、榜单或周挑战事务。

## v1.7 成员端可靠首屏

- 登录后的首页只加载成员必要资料、积分摘要和最近动态；周挑战与成长卡片独立加载，单个接口超时或失败不会阻止提交切片。
- 切片、礼物、积分、转账和兑换记录按首次进入页面加载并缓存，页面级失败可单独重试。
- 成员端只读请求统一在 10 秒后取消并显示可重试提示；`GET /api/dashboard` 保持兼容，`GET /api/videos` 新增可选统计摘要字段。
- 未登录访问根路径时由服务端直接跳转到登录页；根路径和登录页的 HTML 禁止缓存，避免微信 WebView 保留旧页面壳而无法加载新脚本。版本化 `/_next` 静态资源仍保留不可变缓存。
- 登录成功后会先校验会话 Cookie，再以完整页面跳转成员端；若微信 WebView 没有保存会话，会在登录页提示清理网页缓存或改用系统浏览器，而不是循环回到登录页。

## v1.8 成员成长与成就

- 成员首页异步加载私有成长摘要；“我的”页可进入完整成长档案。成长接口的局部失败不会阻塞投稿、兑换或资料入口。
- 成长经验、等级、勋章和月度目标均为独立整数指标，不参与积分余额、转账、兑换、榜单或周挑战结算；视频通过、申诉改判与撤销会在原积分事务内重算。
- `GET /api/member/achievements` 只返回当前会话成员的成长档案、锁定月目标、勋章、高光作品和月度复盘；视频标题、封面、评论数与抓取时间为可选公开元数据，缺失不会影响原审核或积分流程。
- Worker 会幂等封存上月复盘；成员进入成长档案时也会补齐当月档案。验收与 staging 清单见 `docs/ACCEPTANCE-V1.8-MEMBER-ACHIEVEMENTS.md`。
- 完整验收与回滚步骤见 [`docs/ACCEPTANCE-V1.7-RELIABLE-MEMBER-HOME.md`](docs/ACCEPTANCE-V1.7-RELIABLE-MEMBER-HOME.md)。

## 管理后台运营工作台 v2

- 管理后台默认进入“运营工作台”，按上海时区汇总近 7 天或近 30 天的成员参与、通过切片、积分、订单履约和库存风险；待复查申诉、待履约订单、密码找回、失败周挑战和已关闭运营入口均可直接进入对应处理位置。
- 后台支持 URL 深链接（`/admin?section=orders&filter=PENDING_SHIPMENT`）、成员/视频/订单/礼品全局检索，以及视频和订单的脱敏审计动态抽屉。新增后台只读接口都要求 `ADMIN` 会话并返回 `Cache-Control: private, no-store`。
- 视频撤销/重抓、申诉处理与订单履约、驳回、退款会在原有事务前展示影响确认；积分、库存、通知、审计和幂等约束不变，不新增高风险批量审批、Prisma migration 或历史数据回填。
- 完整验收与发布前置见 [`docs/ACCEPTANCE-V2-ADMIN-WORKBENCH.md`](docs/ACCEPTANCE-V2-ADMIN-WORKBENCH.md)。

完整口径、验收和回滚步骤见 [`docs/ACCEPTANCE-V1.6-MEMBER-GROWTH.md`](docs/ACCEPTANCE-V1.6-MEMBER-GROWTH.md)。

## 数据安全

- 密码使用 Argon2id，Session 使用 HttpOnly、Secure（生产环境）和 SameSite Cookie。
- 手机号使用 AES-256-GCM 加密保存。
- 转账、兑换和视频入账在数据库事务内完成，余额使用条件更新防止并发超扣。
- 关键变更写入 `AuditLog`，包含前后值、操作者、IP 和请求标识。
- 注册使用大小写不敏感的快手 ID 唯一校验；关键提交使用幂等键。
- 生产健康检查会拒绝默认数据库密码、无效密钥、Redis 不可用或没有启用管理员的部署。
- 生产健康检查同时校验 Worker 心跳；Worker 会定时恢复因入队或重启中断而滞留的视频任务。
- 默认 Worker 并发为 4，可通过 `VIDEO_WORKER_CONCURRENCY` 调整；按约 310 名成员、峰值 20 人同时使用设计。
- `output/feishu` 中的飞书导出文件已加入忽略规则，不应提交到代码仓库。
- 上线前运行 `npm run data:reconcile` 只读核对积分余额与流水、重复有效视频、待处理申诉、库存及整数积分约束。

## 验证命令

```powershell
npm run lint
npm test
$env:RUN_DB_TESTS="1"; npm test
npm run build
npm audit --omit=dev
docker compose config
docker compose build app
docker build --target worker -t miaomiao-points-worker:verify .
```

正式上线前的外部准备和验收顺序见 `PRODUCTION-READINESS.md`。

## 工程协作

开发约束见 [`AGENTS.md`](AGENTS.md)，完整分支、PR、测试、发布和回滚流程见 [`docs/ENGINEERING-PROCESS.md`](docs/ENGINEERING-PROCESS.md)。单人维护仓库使用维护者自审清单，多人协作时使用非作者审查；任何正式部署仍必须通过 CI、staging 验收和 GitHub `production` 环境批准。

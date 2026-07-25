# 妙妙剪辑团积分中心

这是“妙妙剪辑团积分中心”的可部署版本，包含成员端、管理员端、认证、成员头像、积分账户、视频审核、转账、积分商城、榜单结算和飞书迁移工具。

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

Linux 服务器使用 `bash scripts/backup-db.sh backups .env.production` 备份，恢复使用 `bash scripts/restore-db.sh <备份文件> .env.production`；Windows 运维可使用对应的 `.ps1` 脚本。备份会生成 SHA-256 校验文件，应保存到独立存储，不要放进代码仓库。

新服务器首次准备可由 root 执行 `bash scripts/bootstrap-server.sh`，它会安装 Docker/Compose、配置 2GB Swap、限制入站端口并创建 `/opt/miaomiaojianjituan`。正式 workflow 会在备份和启动容器前执行 `bash scripts/production-preflight.sh`，检查生产密钥、非默认数据库密码、Docker Compose 和 HTTPS 证书。

正式发布由 GitHub Actions 校验已合并的 release commit，再通过专用部署账号让生产服务器拉取该 commit，并利用本机 Docker/BuildKit 缓存构建 App/Worker 镜像。构建成功后才生成发布前备份、执行 migration、切换 Web/Worker 并刷新 Nginx。该流程不再通过低带宽 SSH 链路传输完整镜像；详细设计和耗时目标见 [`docs/RELEASE-PIPELINE.md`](docs/RELEASE-PIPELINE.md)。

## 快手视频抓取

成员可以粘贴短链接、长链接或包含链接的分享文本。服务端只接受 `kuaishou.com` 域名，Worker 使用参数数组调用 `curl -sS -L -A "Mozilla/5.0" --max-time 10`，从页面源码解析 `likeCount`、`viewCount`、`photoId` 和 `userName`。

作者名会先做 NFKC 规范化、去除 emoji/符号、团名标记和常见装饰差异，再按双向包含、团名别名和有限编辑距离判断。匹配成功才自动入账；作者不一致、低赞、超期、重复、字段缺失或链接失效都会自动驳回，不进入普通人工队列。快手页面抓取使用 5 次递增退避，耗尽后才判定链接不可用。

成员可对自动驳回记录提交一次待处理申诉；只有申诉进入管理员复查。申诉通过时管理员可以确认或修改整数积分，视频入账、申诉状态和审计日志在同一事务完成。

视频提交规则：

- 只结算提交时发布时间不超过 7 天、点赞量至少 200 的视频。
- 200–1000 赞兑换 50 积分；超过 1000 赞按 `floor(点赞量 / 2)` 计算，最高 5000 积分。
- `photoId` 对处理中、待审核和已通过记录全局唯一，同一视频不能重复结算。
- 已驳回记录不占用唯一约束，修正问题后可以重新提交。
- 新规则只影响后续抓取和申诉处理，不自动重算历史已到账积分。上线前可用 `npm run video:audit-approved` 只读复查样本，使用 `npm run video:reprocess-pending -- --apply` 批量重抓旧的失败/历史待审核记录。

## 榜单与领奖

- 周更新排行榜：按当周提交且通过的视频数量排序。
- 月点赞量排行榜：按当月提交且通过视频在提交时抓取的点赞量总和排序。
- 总积分排行榜：按成员当前可用积分排序。
- Worker 不再自动补结算周榜/月榜；管理员从后台选择已结束周期，预览前五名并显式确认结算。
- 现金商城礼品必须填写收款码；实物商城礼品和周/月榜奖励统一收集收货姓名、手机号和详细地址，榜单奖励不依赖商城礼品目录。
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
- `ALERT_WEBHOOK_URL` 可接入外部告警系统；Worker 失败、Redis/Worker 不可用、队列滞留、每日对账异常和备份异常会发送脱敏告警。
- 每日巡检执行 `npm run ops:daily-check`，备份校验执行 `npm run ops:verify-backups`；建议由 cron/任务计划程序运行并保留输出。
- 管理后台系统设置可导出订单、积分、视频和审计四类脱敏 CSV；CSV 已防止公式注入，手机号、地址、收款码、密码和原始抓取 payload 不导出。

本阶段 migration 为 `prisma/migrations/20260724010000_notifications_announcements`，只新增通知、公告及收件人表。回滚应用版本时保留这些表和历史通知，不删除已执行 migration；如需停用功能，应以前向修复或配置关闭入口。

## v1.3 AI 个性化周挑战

- 周日 18:00 起按 `Asia/Shanghai` 为下一周冻结有效普通成员并生成匿名任务，23:00 仍未完整生成则整周失败，不发布规则兜底任务。
- DeepSeek 每批最多处理 25 名匿名成员，只接收入团天数、四个完整周的视频/点赞聚合、最好成绩、趋势和历史任务完成率。昵称、快手 ID、手机号、地址、余额和视频链接不会进入提示词。
- 任务支持通过视频数、点赞总量和组合目标。服务端重新校验成员覆盖、唯一性、整数目标、新人至少两条通过视频、个人 `10–1500` 分和整周 `10,000` 分预算。
- 周一自动激活；成员只查看自己的基线、进度、说明和奖励。个人奖励达标后主动领取，截止到下一周周三 23:59；固定 `2,000` 分竞速奖励在达标视频通过事务中抢占。
- 视频撤销会在同一事务内重新计算任务，必要时冲正个人与竞速积分，并把竞速奖励改发给仍达标且最早完成的成员。
- 管理后台可查看周期覆盖、预算、任务分布、模型批次和失败原因；“周挑战积分发放”开关默认关闭，关闭时保留只读查询。

本地或 staging 配置 `DEEPSEEK_BASE_URL`、`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL` 和 `ALERT_WEBHOOK_URL` 后再启用周挑战。测试使用本地模拟服务，不读取真实密钥。生产镜像还必须在构建时注入 `APP_COMMIT_SHA` 与 `APP_BUILD_TIME`；健康接口会返回 App/Worker 版本并拒绝版本不一致的部署。

正式发布从 GitHub `production` Environment 读取变量 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` 和 Secrets `DEEPSEEK_API_KEY`、`ALERT_WEBHOOK_URL`，由部署 workflow 写入服务器环境文件；禁止将这些密钥提交到仓库。

v1.3 migration 为 `prisma/migrations/20260725120000_weekly_challenges`，只新增枚举、表、关系和索引。应用回滚时关闭周挑战开关并回退 Web/Worker，保留新增表和积分审计历史，不回退已执行 migration。完整验收与影子运行要求见 [`docs/ACCEPTANCE-V1.3-WEEKLY-CHALLENGES.md`](docs/ACCEPTANCE-V1.3-WEEKLY-CHALLENGES.md)。

## 批量积分

- 管理后台支持一次选择一名或多名有效普通成员，也可以选择全体成员，以相同的整数积分和原因批量增减，不设置人数上限。
- 批量操作使用请求幂等键派生每名成员的积分流水和通知去重键；成员校验、余额条件扣减、流水、通知和审计在一个事务中完成。任一成员不存在、停用或余额不足，整批回滚。后台可直接选择全部有效普通成员，不按人数截断。
- 后台成员选择支持搜索、保留跨搜索选择、选择当前结果、清空选择和提交前确认摘要。单成员 `POST /api/admin/points` 接口保持兼容。

## 数据安全

- 密码使用 Argon2id，Session 使用 HttpOnly、Secure（生产环境）和 SameSite Cookie。
- 手机号使用 AES-256-GCM 加密保存。
- 转账、兑换和视频入账在数据库事务内完成，余额使用条件更新防止并发超扣。
- 关键变更写入 `AuditLog`，包含前后值、操作者、IP 和请求标识。
- 注册使用大小写不敏感的快手 ID 唯一校验；关键提交使用幂等键。
- 生产健康检查会拒绝默认数据库密码、无效密钥、Redis 不可用或没有启用管理员的部署。
- 生产健康检查同时校验 Worker 心跳；Worker 会定时恢复因入队或重启中断而滞留的视频任务。
- 默认 Worker 并发为 4，可通过 `VIDEO_WORKER_CONCURRENCY` 调整；按约 200 名成员、峰值 20 人同时使用设计。
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

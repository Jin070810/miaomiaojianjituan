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
- Worker 自动补结算已结束的周榜和月榜，每期前五名生成领奖记录。
- 现金商城礼品必须填写收款码；实物商城礼品和周/月榜奖励统一收集收货姓名、手机号和详细地址，榜单奖励不依赖商城礼品目录。
- 收款码和收货档案可保存复用；手机号和地址加密存储，管理员后台按权限解密查看。
- 兑换提交时在同一事务内校验积分和库存，成功后订单自动进入“待发货”；管理员无需审批，只负责完成/发货，或驳回并原路退回积分与库存。

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

开发约束见 [`AGENTS.md`](AGENTS.md)，完整分支、PR、测试、发布和回滚流程见 [`docs/ENGINEERING-PROCESS.md`](docs/ENGINEERING-PROCESS.md)。任何正式部署必须经过人工审查和 GitHub `production` 环境批准。

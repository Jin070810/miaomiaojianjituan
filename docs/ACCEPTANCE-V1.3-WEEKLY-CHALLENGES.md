# v1.3 AI 个性化周挑战验收与发布清单

## 2026-07-26 生成失败修复

生成提示词升级为 `weekly-challenge-v4-hard-combined-two-week`。模型只接收最近两周逐周的发布量、总点赞、平均点赞、最高点赞和最低点赞，自行判断参考基线；服务端不再预先计算四周中位数。每个任务必须同时包含视频发布量和累计点赞量，服务端按“够一够、努努力、很难但可试”生成三个递增阶段，第一档 100 分，最终累计 300–1000 分，领取时只发放相对上次的差额。

只有上周（上一完整上海周）有过非失败视频提交的成员才会进入本周 audience。没有提交记录的成员不会调用模型、不会创建任务；当整周没有符合条件的成员时，周期会以零任务 `READY`，不消耗模型 token。

发布后的恢复顺序：

1. 确认 App 与 Worker 是同一已审查 commit，`/api/health` 的数据库、Redis、Worker 和 DeepSeek 配置均为 `ok`。
2. 在后台“AI 周挑战”对失败周期点击“重试”；不得直接编辑数据库或删除失败周期。
3. 生成完成后核对状态为 `READY`、任务数等于上周提交成员数、所有任务类型均为 `COMBINED`、每个任务有 3 个递增阶段、最终奖励为 `300–1000`，`finalFailedBatches` 为空，且奖励策略版本为 `tiered-v2-hard-combined`。
4. 旧版本已生成但尚未生效的 `READY` 周期，必须在后台点击“按两周数据重新生成”。该操作会先将周期置为不可发布状态、重新冻结上周投稿成员，再由模型根据生产真实两周数据判断基线并生成综合三阶段任务；生成成功前旧任务不会激活，不可直接编辑数据库。
5. 周一 00:00 后再执行生命周期巡检，确认周期变为 `ACTIVE` 且成员端可见任务。

若重试仍失败，保持周挑战开关关闭，保留生成尝试和告警记录，先修复模型配置或提示词契约后再重试。

## 状态

此版本在人工审查、脱敏生产副本 migration 演练、staging 影子运行和发布记录完成前只能标记为 `Ready for review`。

## 配置

- `DEEPSEEK_BASE_URL`：OpenAI 兼容服务根地址，必须使用 HTTPS。
- `DEEPSEEK_API_KEY`：仅由部署环境注入，不写入仓库、镜像层或日志。
- `DEEPSEEK_MODEL`：经 staging 验证的模型名称。
- 告警通道：配置 `ALERT_WEBHOOK_URL`，或完整配置 `ALERT_EMAIL_TO`、`ALERT_SMTP_HOST`、`ALERT_SMTP_USER`、`ALERT_SMTP_PASSWORD`；用于生成失败、模型失败和每日巡检告警。
- `APP_COMMIT_SHA`、`APP_BUILD_TIME`：由正式构建 workflow 注入；不得人工填写为与镜像不符的值。

GitHub `production` Environment 必须配置变量 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` 和 Secret `DEEPSEEK_API_KEY`，并提供 Webhook Secret 或完整 SMTP 邮件配置。包含手机号的 `ALERT_EMAIL_TO`、`ALERT_EMAIL_FROM`、`ALERT_SMTP_USER` 与授权码均使用 Secrets；部署 workflow 会将配置原子写入服务器的 `.env.production`，不输出密钥内容。

生产前置检查会拒绝缺少 DeepSeek、告警、数据库密钥、证书或 HTTPS 的发布。`/api/health` 必须返回与发布请求相同的 App/Worker SHA。

维护者明确决定先部署代码、后配置告警时，可以在生产 workflow 勾选 `confirm_alert_deferred`。该例外必须记录在发布单中，且 workflow 必须验证 `weeklyChallenges.enabled == false`；在真实告警和 DeepSeek 影子验证完成前不得启用周挑战。

## 数据库

Migration：`prisma/migrations/20260725120000_weekly_challenges/migration.sql`、`prisma/migrations/20260726130000_weekly_challenge_tiered_rewards/migration.sql`

- 只新增周挑战枚举、周期、任务、生成记录、竞速冠军表和积分/通知枚举值；阶梯 migration 仅新增奖励策略版本、阶段 JSON 和领取累计字段，保留旧 `rewardPoints` 以兼容历史任务。
- 唯一约束覆盖周期开始时间、周期成员、领奖幂等键、生成批次尝试、周期竞速冠军和冠军任务。
- 在脱敏生产副本执行 `npx prisma migrate deploy`，核对 migration 时间、表数量、索引和现有积分对账。
- 已执行 migration 不回退；应用回滚时保留新增表。

## 自动化验收

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

周挑战专项自动化必须覆盖：

- 上海周界、周三领奖截止、周日 23:00 生成截止。
- 新人两条通过视频下限、目标上下界、恶意或越界输出、三阶段累计奖励和 100–1000 奖励边界。
- audience 只包含上一完整周有非失败提交的成员；空 audience 不调用模型并正常进入 `READY`。
- 300 人按 25 人分批完整生成；缺失或重复成员连续三次失败后整周零任务。
- 并发完成只产生一个竞速冠军；并发领取只产生一笔奖励流水。
- 视频撤销后的个人奖励冲正、竞速冲正和最早合格成员改发。
- 模拟 DeepSeek 的非法 JSON、HTTP 429、5xx 和超时，不调用真实付费服务。

## Staging 影子运行

1. 周挑战开关保持关闭，用至少 300 名匿名样本回放两个完整历史周。
2. 核对每周覆盖人数、个人最终奖励 `300–1000`、每项包含 3 个累计阶段（首档 100 分）、个人预算为 `成员数 × 1,000`、竞速池固定 `2,000`。
3. 人工抽查任务可理解性、20%–35% 常规提升和突破目标上限。
4. 验证失败批次不会创建任何成员任务，管理员可查看失败原因并在截止前重试。
5. 用测试账号验证分阶段达标、重复领取只产生一笔阶段流水、撤销只冲正失效阶段差额并允许继续完成、竞速改发，运行 `npm run data:reconcile` 与 `npm run ops:daily-check`。
6. Playwright 在 `390×844` 和 `1440×900` 验证空数据、进行中、已达标、领取成功、竞速结束、运营暂停、生成失败和加载状态。

真实 DeepSeek 影子运行使用全新的 `shadow_`/`staging_` 独立 schema：

```powershell
$env:DATABASE_URL="postgresql://.../miaomiao?schema=shadow_v13_rc"
npx prisma migrate deploy
$env:WEEKLY_CHALLENGE_SHADOW_CONFIRM="I_UNDERSTAND_PAID_DEEPSEEK_SHADOW"
npm run weekly:shadow
```

保存脚本输出、告警接收记录和后台截图作为发布记录。脚本会拒绝 `public` 或任何非空 schema，不使用真实成员资料，不会开启周挑战积分发放，并要求结果告警成功送达。

PR 合并成 release candidate 后，优先从 `main` 手动触发 `Weekly Challenge DeepSeek Shadow` workflow 并确认付费运行。工作流使用一次性 PostgreSQL service，不读取生产数据库；成功后下载并归档 `weekly-challenge-deepseek-shadow` artifact。

## 上线与回滚

- 首次上线开关默认关闭；真实 DeepSeek 与告警已验证、影子运行完成并由维护者明确确认后才能开启。
- 发布记录包含版本、commit、migration、模型名称、提示词版本、维护者、备份、时间和回滚点。
- 回滚时先关闭 `WEEKLY_CHALLENGES`，再回退 App/Worker 到同一已审查 commit；不删除周挑战表，不回退数据库。
- 如发生重复入账或异常冲正，立即关闭周挑战积分发放，保留审计、数据库快照和告警记录，使用前向修复。

# v1.3 AI 个性化周挑战验收与发布清单

## 状态

此版本在人工审查、脱敏生产副本 migration 演练、staging 影子运行和发布记录完成前只能标记为 `Ready for review`。

## 配置

- `DEEPSEEK_BASE_URL`：OpenAI 兼容服务根地址，必须使用 HTTPS。
- `DEEPSEEK_API_KEY`：仅由部署环境注入，不写入仓库、镜像层或日志。
- `DEEPSEEK_MODEL`：经 staging 验证的模型名称。
- `ALERT_WEBHOOK_URL`：生成失败、模型失败和每日巡检告警地址。
- `APP_COMMIT_SHA`、`APP_BUILD_TIME`：由正式构建 workflow 注入；不得人工填写为与镜像不符的值。

GitHub `production` Environment 必须配置变量 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`，以及 Secrets `DEEPSEEK_API_KEY`、`ALERT_WEBHOOK_URL`。部署 workflow 会将四项配置原子写入服务器的 `.env.production`，不输出密钥内容。

生产前置检查会拒绝缺少 DeepSeek、告警、数据库密钥、证书或 HTTPS 的发布。`/api/health` 必须返回与发布请求相同的 App/Worker SHA。

## 数据库

Migration：`prisma/migrations/20260725120000_weekly_challenges/migration.sql`

- 只新增周挑战枚举、周期、任务、生成记录、竞速冠军表和积分/通知枚举值。
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
- 新人两条通过视频下限、目标上下界、恶意或越界输出、300 人奖励缩放。
- 300 人按 25 人分批完整生成；缺失或重复成员连续三次失败后整周零任务。
- 并发完成只产生一个竞速冠军；并发领取只产生一笔奖励流水。
- 视频撤销后的个人奖励冲正、竞速冲正和最早合格成员改发。
- 模拟 DeepSeek 的非法 JSON、HTTP 429、5xx 和超时，不调用真实付费服务。

## Staging 影子运行

1. 周挑战开关保持关闭，用至少 300 名匿名样本回放两个完整历史周。
2. 核对每周覆盖人数、个人奖励 `10–1500`、个人池不超过 `10,000`、竞速池固定 `2,000`。
3. 人工抽查任务可理解性、20%–35% 常规提升和突破目标上限。
4. 验证失败批次不会创建任何成员任务，管理员可查看失败原因并在截止前重试。
5. 用测试账号验证达标、重复领取、撤销、冲正和竞速改发，运行 `npm run data:reconcile` 与 `npm run ops:daily-check`。
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

# v1.4 稳定运营版验收

状态：`Ready for review`。未完成人工审查、staging 等效验收、本地备份恢复演练和正式发布记录前，不得标记为已上线。

## 代码范围

- 不存在 `WeeklyChallengePeriod.isPreview` 或 `20260725170000_weekly_challenge_preview` migration。
- 成员端视频输入为最多 2,000 字的多行分享文本，粘贴按钮读取真实 Clipboard API。
- 订单写操作展示处理中、成功和接口错误；资料不足不发送写请求。
- 后台首屏只加载 `/api/admin/dashboard`，菜单模块按需加载并缓存，错误局部重试。
- 成员接口使用 50 条分页；批量积分的全部有效成员由服务端事务内解析。
- 生产默认 `BACKUP_STORAGE_MODE=local`，不要求 OSS；每日备份校验并轮转 7 天，发布前创建轻量服务器免费快照。

## 自动门禁

```powershell
npm run lint
npm test
$env:RUN_DB_TESTS="1"; npm test
npm run build
npm audit --omit=dev
docker compose config
docker compose build app
docker build --target worker -t miaomiao-points-worker:verify .
npm run test:e2e
```

Playwright 必须在 `390x844` 覆盖剪贴板、超长文案、提交成功/失败/加载，在 `1440x900` 覆盖首屏请求、按需加载、局部失败重试、缓存、订单资料阻断和跨页选择。截图保存在 CI artifact，不提交运行输出。

## Staging 与发布

1. 在服务器验证本地 dump、SHA-256、7 天清理和失败告警，不把生产数据上传为 workflow artifact。
2. 从最新本地 dump 恢复到隔离 PostgreSQL，运行 `data:reconcile` 并保存脱敏证据。
3. 四类改动分别由人工审查：UI 修复、备份恢复、后台治理、E2E/发布文档。
4. 发布只接受已合并到 `main` 的完整 SHA，Web 与 Worker 使用同一版本。
5. 发布后观察至少 30 分钟，记录版本、commit、migration、操作者、时间和回滚点。

回滚应用前关闭受影响入口并评估 migration；本版不含数据库 migration。生产事故保留审计、快照和告警证据，采用前向修复处理不可逆数据问题。

零新增费用方案不提供真正异地备份：本地 dump 与生产数据库同机，免费快照用于发布回滚。该残余风险已在备份手册中记录；不得为满足原 OSS 方案擅自开通付费资源。

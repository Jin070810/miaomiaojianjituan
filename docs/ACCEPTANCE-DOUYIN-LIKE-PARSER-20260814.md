# 抖音视频点赞解析验收记录

状态：`Ready for review`。代码和本地自动化验证已完成；尚未完成 PR 审查、隔离 staging 验收、合并和正式发布记录，因此本文件不代表已上线。

## 变更范围

- 成员提交支持抖音短链接、长链接和完整分享文案。
- Worker 使用 Chromium 跳转抖音链接，读取目标 `aweme_id` 对应的精确 `statistics.digg_count`。
- 普通视频和图文作品均支持；提交时将 `aweme_id` 写入现有 `photoId` 字段。
- 点赞量和积分按提交时抓取结果固化，后续点赞变化不重算历史积分。
- 复用现有有效状态下的 `photoId` 重复提交校验；本次无 Prisma migration。

## 验证记录

- `npm run lint`：通过。
- `npm test`：124 passed，57 个数据库集成测试因本地未配置隔离数据库而跳过。
- `npm run build`：通过。
- `npm audit --omit=dev`：0 vulnerabilities。
- `docker compose config`：通过。
- 真实浏览器抓取普通视频和图文样例：均成功返回目标 `aweme_id`、作者和精确点赞量。

## 未完成项

- 在隔离 staging PostgreSQL/Redis 上执行 `RUN_DB_TESTS=1 npm test`、对账和视频提交/重复提交验收。
- 在 staging 使用 390×844 和 1440×900 验收登录、提交、成功、失败、加载和禁用状态。
- GitHub Actions CI、PR 审查和合并后的生产发布 workflow。

## 回滚

本次无数据库结构变更。应用回滚到合并前的 release commit 即可；App 与 Worker 必须使用同一个 release SHA，并通过受控 `Deploy Production` workflow 执行。

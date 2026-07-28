# v1.6 成员成长反馈验收

## 状态与边界

- 当前状态：`Ready for review`，尚未完成 PR、staging、正式发布和生产观察。
- 不新增数据库 migration，不新增积分、勋章或互动玩法。
- 不修改积分入账、榜单结算、周挑战生成/领取和视频审核规则。
- 加载页长期卡住问题作为独立缺陷跟踪，不属于本功能分支。

## 指标口径

- 时区固定为 `Asia/Shanghai`，每周一 00:00 开始新周期。
- 只统计 `APPROVED` 视频，按 `submittedAt` 归属周期。
- 点赞使用视频记录已保存的点赞快照；空值按 0 处理。
- 视频积分只汇总 `VideoSubmission.points`，不混入转账、管理员调整、退款或榜单奖励。
- 上周同期的窗口长度与本周已经流逝的时间相同，区间统一使用 `[start, end)`。
- 最近 8 周包含当前周与前 7 周；当前周标记为进行中。
- 上期为 0 且本期大于 0 时显示“本周开始有记录”，不显示百分比。

## 接口验收

### `GET /api/member/growth`

- 未登录返回 HTTP 401。
- 仅查询当前登录成员自己的数据。
- 返回 `timezone`、`generatedAt`、`currentWeek`、`previousWeekSameWindow`、`delta`、8 个 `trend` 周桶和最多 3 条 `topVideos`。
- 每个周期指标包含 `start`、`end`、`approvedVideos`、`likes`、`videoPoints`、`averageLikes`。
- 不返回手机号、地址、收款码、密码、其他成员身份或原始抓取数据。

### `GET /api/admin/dashboard`

- 服务端继续执行管理员 RBAC。
- 新增可选 `memberGrowth` 字段，旧客户端在字段缺失时仍可运行。
- 当前周和上周同期统计只包括有效普通成员。
- 周挑战只返回覆盖、达标和已领取人数，不返回成员明细。

## UI 验收

在 `390×844` 和 `1440×900` 分别验证：

1. 首页主数据先完成时立即可用，成长卡片继续独立加载。
2. 成长接口失败只显示局部错误；点击“重新加载”后恢复。
3. 增长、下降、持平、上期为 0、完全空数据和超大数值均不溢出。
4. 成长记录固定显示 8 个周桶，当前周有明确标记。
5. 本月无通过视频时展示空状态；有数据时最多显示 3 条并按点赞降序。
6. 下一步建议严格遵循：可领取奖励、异常切片、进行中挑战、本周首条提交、成长记录。
7. 首页、成长记录、个人中心入口和返回路径均可键盘及触摸操作。
8. 页面根节点没有横向溢出或底部导航遮挡。

## 自动化与发布门禁

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

发布前还必须完成：

- 最新 `main` 独立功能分支与 PR 自审/审查。
- 隔离 staging 数据库验收，不使用真实生产成员资料。
- 发布前数据库备份和 SHA-256 校验。
- App/Worker 使用同一 release commit。
- 生产 `/api/health`、成长接口错误率和响应时间观察至少 30 分钟。

## 回滚

- 本版没有 migration，异常时回滚 Web 与 Worker 到 `v1.5.1`。
- 不删除视频、积分、周挑战或统计来源数据。
- 若发现积分或敏感数据异常，先关闭对应高风险写入口并保留审计、日志和备份，再执行回滚。

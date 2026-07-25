# 20260725120000 Weekly Challenges

## 变更

该 migration 只新增：

- `WeeklyChallengePeriodStatus`、`WeeklyChallengeType`、`WeeklyChallengeAssignmentStatus`、`WeeklyChallengeAttemptStatus`。
- `WeeklyChallengePeriod`、`WeeklyChallengeAssignment`、`WeeklyChallengeGenerationAttempt`、`WeeklyRaceWinner`。
- 周挑战个人奖励、竞速奖励及冲正的 `LedgerType`。
- `WEEKLY_CHALLENGE` 通知类型。
- 周期、成员任务、领奖幂等键、生成尝试和竞速冠军的唯一约束与查询索引。

未删除或修改现有列、表和历史 migration。

## 演练

在脱敏生产副本执行：

```powershell
npx prisma migrate deploy
$env:RUN_DB_TESTS="1"; npm test
npm run data:reconcile
```

记录执行时间、数据库版本、迁移前后表/索引、积分对账结果和备份校验值。

## 回滚

该 migration 不做数据库回退。需要停止功能时关闭 `WEEKLY_CHALLENGES`，回退 App/Worker 到同一旧版本，并保留新增表、积分流水、通知和审计。结构问题使用新的前向 migration 修复。

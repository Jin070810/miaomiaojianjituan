# 20260804170000 Weekly Challenge Resilience

## 变更

该 migration 是纯新增变更：

- 新增 `WeeklyChallengeGenerationSource`：区分 AI 与确定性模板尝试。
- 新增 `WeeklyChallengeGenerationMode`：记录周期最终为 `AI`、`HYBRID` 或 `DETERMINISTIC`。
- 周期新增降级批次数和生成警告；生成尝试新增运行 ID、输入哈希和来源。
- 新增按周期、批次、输入哈希和状态查询成功检查点的索引。

默认值保持历史记录兼容。migration 不删除或重命名字段，不修改任何已执行 migration。

## 演练

在脱敏生产副本执行并保存结果：

```powershell
npx prisma migrate deploy
$env:RUN_DB_TESTS="1"; npm test
npm run data:reconcile
```

核对 migration 状态、枚举和索引存在，历史周期仍可读取，积分余额与流水对账不变。再用 300 名合成成员验证纯 AI、混合降级、完全降级和检查点复用。

## 回滚

该 migration 不做数据库回退。应用回滚前关闭 `WEEKLY_CHALLENGES`，同时回退 Web 与 Worker 到同一已审查版本；新增列和索引继续保留。结构问题使用新的前向 migration 修复。

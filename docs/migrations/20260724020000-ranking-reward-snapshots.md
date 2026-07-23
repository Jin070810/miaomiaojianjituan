# 榜单奖励快照 Migration

本 migration 仅为 `RankingAward` 增加可空的 `rewardTitle` 和 `rewardDescription`。新结算会将管理员填写的奖励文字保存为历史快照，既有榜单奖励和领奖状态不重算、不迁移。

部署前在 staging 执行 `npm run db:deploy` 并验证周期边界、并发结算、领奖资料和完成发放。应用回滚时保留新增列，不修改或删除既有榜单数据；必要时以前向修复兼容旧版本。

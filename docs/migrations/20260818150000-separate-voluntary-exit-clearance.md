# 20260818150000 Separate Voluntary Exit From Clearance

本 migration 只修正数据语义，不改变数据库结构：`MemberEligibility.clearedAt` 仅代表系统因长期无有效产出执行的自动清退。

对于状态为 `EXEMPT`、存在 `MEMBER_VOLUNTARILY_LEFT` 审计且从未存在 `MEMBER_AUTO_CLEARED` 审计的资格记录，migration 将误写的 `clearedAt` 清空。主动退团审计、成员状态历史、积分流水和账号停用状态全部保留。

## 验证

- migration 前记录受影响行数，并与主动退团审计数量核对。
- migration 后确认自动清退名单只包含存在 `MEMBER_AUTO_CLEARED` 审计的资格记录。
- 确认主动退团记录仍可在“用户与公会 → 主动退团”查询。
- 运行数据库集成测试和 `npm run data:reconcile`。

## 回滚

不逆向恢复误分类的 `clearedAt`。如发现筛选条件错误，保留审计与积分历史，使用新的前向 migration 修正；应用可回退，但本 migration 保留。

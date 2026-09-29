-- 审计日志是只增不改的大表，管理端按操作人/动作筛选是最常用路径，补齐复合索引。
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- 删除三个与唯一约束完全同列的冗余二级索引：唯一约束本身自带同结构索引，
-- 重复索引只有写放大没有查询收益。回滚时按上面的 CREATE INDEX 语句重建即可。
DROP INDEX "MemberMonthlyGoal_userId_monthStart_idx";
DROP INDEX "MemberMonthlyReview_userId_monthStart_idx";
DROP INDEX "RankingEntry_periodId_rank_idx";

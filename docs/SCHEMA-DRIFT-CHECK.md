# Schema 与历史 migration 对齐

关联总工作项 #105。修复对象是 Prisma 声明与历史 migration 的差异；没有改写历史 migration，没有执行删除索引、改默认值或索引改名。

## 已复现的差异

在全新的隔离 PostgreSQL 16 数据库重放全部 38 个现有 migration，使用仓库锁定的 Prisma 6.19.3 比较实际库和 `schema.prisma`，原声明会生成四项多余变更：

| 实际数据库结构 | 原 Prisma 差异 | 本次处理 |
| --- | --- | --- |
| `Gift_deletedAt_active_displayOrder_idx` | 计划删掉旧索引 | 声明已有索引，保留其排序用途 |
| `SystemSetting.updatedAt` 有数据库当前时间默认值 | 计划去掉默认值 | 增加 `@default(now())`，保留 `@updatedAt` |
| 周挑战尝试次数复合唯一索引 | 长 SQL 名称由 PostgreSQL 截短，与 Prisma 默认命名不同 | 使用 `map` 对应实际名称，唯一字段不变 |
| 周挑战输入摘要复合索引 | 同上 | 使用 `map` 对应实际名称，索引字段不变 |

修改前 `migrate diff --exit-code` 返回 2；修改后返回 0，输出 `No difference detected`。此验证没有使用生产数据；它证明仓库 migration 可重放且与声明一致，不能替代脱敏生产副本演练。

## 使用与 CI

```powershell
npm run db:deploy
npm run db:check-drift
```

`db:check-drift` 使用 `schema.prisma` 中的 datasource，通过 `DATABASE_URL` 读取目标库。该命令只比较结构，不应用生成的变更、不执行 reset、不创建 shadow database。退出码 0 表示无差异，2 表示有差异，1 表示执行错误。CI 在隔离数据库执行完 migration 后、测试前运行它，任何非零结果都阻止继续构建。

对于已部署的环境，先确认 `DATABASE_URL` 指向待检查的目标；保存只含结构的诊断结果，查明差异来源后再决定是否新增 migration。不要直接把 diff 的 SQL 应用到生产，也不要修改 `_prisma_migrations` 的校验值来隐藏差异。

## 检查边界

Prisma diff 只覆盖其支持的数据库对象；当前项目 Prisma 6 中由原始 SQL 管理的 trigger、CHECK、函数和部分唯一索引，需要继续使用集成测试和迁移校验。不能把“无差异”解释为积分不变量、所有触发器或线上数据均已验证。[官方 CLI 说明](https://docs.prisma.io/docs/orm/reference/prisma-cli-reference)

此 PR 无数据库写入 migration。回退应用不要求回退数据库，但原声明的差异会重新出现。旧索引是否多余应另据真实查询计划和写入成本评估，不能在本次一致性修复中顺手删除。

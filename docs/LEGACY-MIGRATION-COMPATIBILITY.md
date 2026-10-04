# 历史迁移校验兼容记录

2026-10-04 真实副本演练 [37184823509](https://github.com/Jin070810/miaomiaojianjituan/actions/runs/37184823509) 使用已校验备份 `miaomiao-20261003-211358.dump`，候选为 `ef6ea1e5bd86cf5242b5c50dd5d331d2bb990008`。在隔离副本执行 6 项新迁移、重复执行、Prisma drift 和完整逻辑结构比较均通过；迁移后结构与全部 44 项 SQL 新建的参考库一致，积分汇总保持，无账户余额差异。隔离容器已移除，生产服务保持。运行仍按设计返回失败，因为当时尚未登记以下历史差异。

| 迁移 | 已知原因与边界 |
| --- | --- |
| `202607230001_init` | 生产记录精确匹配当前 SQL 的 CRLF 形式，仓库使用 LF；SQL 语义相同。 |
| `20260723120000_business_rules` | 仓库首次提交已是当前文件内容，未找到匹配该历史校验值的原始文件。此次不推测原 SQL；依据实际副本迁移、约束/部分索引/函数/触发器结构一致和数值守恒，登记当前状态兼容。 |
| `20260723123000_ranking_award_qr` | 生产记录精确匹配只向 RankingAward 添加 cashQrCodeUrl 的早期单条 SQL；仓库后来加入 IF NOT EXISTS 和 RecipientProfile，后续 recipient_profile_qr 迁移也覆盖该字段，实际完整结构已核实一致。 |

精确历史值、当前文件值及证据 SHA/run 固定在 `scripts/legacy-migration-checksums.json`。可信 main 的校验器只接受名称、两端完整哈希和证据标识全部匹配的条目，保留原差异进入发布记录。未知差异、修改当前 SQL 后的新哈希，或没有证据的条目仍失败；回滚兼容说明不能覆盖它们。副本结构相同不会自动新增兼容条目。

不改写历史 SQL 或数据库 `_prisma_migrations`，不使用 migrate resolve 抹除历史。新 migration 继续只允许新增并执行完整门禁。按所有者自动发版的持续授权完成此技术兼容处理，无须伪造人工 approval。

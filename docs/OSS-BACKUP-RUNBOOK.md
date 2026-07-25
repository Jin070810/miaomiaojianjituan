# 数据库备份与恢复手册

## 当前零成本方案

生产运行在阿里云轻量应用服务器，不是 ECS，不能使用 ECS RAM 实例角色。OSS 尚未开通且开通会产生按量费用，因此当前设置：

```dotenv
BACKUP_STORAGE_MODE=local
LOCAL_BACKUP_RETENTION_DAYS=7
```

`Production Database Backup` 每天上海时间 02:15 在生产服务器执行 `pg_dump`，生成 SHA-256 校验文件并立即校验，删除超过 7 天的本地 dump 和 sidecar。失败时调用现有 SMTP/Webhook 告警。

发布前在轻量应用服务器控制台创建一个免费快照，并记录快照 ID。当前一台实例有 3 个免费快照额度，创建前必须确认页面仍显示免费额度且不会产生费用；超过额度时停止，不购买。发布稳定后按发布记录轮转旧快照。

该方案有明确边界：本地 dump 与数据库位于同一台服务器、同一云产品，不能抵御整机或账号级故障；免费快照主要用于发布回滚，不替代真正异地备份。只要“零新增费用”约束不变，就接受这一残余风险并通过每日校验、月度恢复演练和发布快照降低风险。

## 每日备份

workflow 支持两种模式：

- `local`：默认模式，只在服务器本地生成、校验和轮转备份，不要求任何 OSS 配置。
- `oss`：未来取得费用批准且运行环境支持 ECS 实例角色后，额外上传并回下载校验。

本地模式成功证据包含 workflow run ID、备份文件名、SHA-256 校验结果和保留期。备份文件权限继承生产目录访问控制，禁止提交到 Git 或作为公开 artifact 上传。

## 月度恢复演练

`Monthly Database Restore Drill` 每月 2 日上海时间 02:45 执行：

1. 本地模式选取最新 dump 并校验 sidecar；OSS 模式下载最新对象并校验。
2. 将 dump 恢复到同一服务器上的隔离 PostgreSQL 16 临时容器。
3. 执行 `npm run data:reconcile` 和成员数量检查。
4. 删除临时数据库和临时目录。
5. 将不含生产数据的命令输出保存为受保护 workflow artifact。

演练记录至少包含 run ID、执行时间、备份文件名、SHA-256 结果、对账结果、记录数量、操作者和结论。失败时保留 workflow 日志并触发告警，不使用生产数据库作为恢复目标。

## 可选 OSS 模式

OSS 模式当前不启用。未来只有在用户明确批准新增费用，并确认运行环境可使用 ECS 实例角色后才可配置。禁止创建长期 AccessKey。最小权限示例中的资源范围必须替换为实际 Bucket：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["oss:PutObject", "oss:GetObject"],
      "Resource": ["acs:oss:*:*:<BUCKET>/miaomiao/production/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["oss:ListObjects"],
      "Resource": ["acs:oss:*:*:<BUCKET>"],
      "Condition": { "StringLike": { "oss:Prefix": ["miaomiao/production/*"] } }
    }
  ]
}
```

配置：

```dotenv
BACKUP_STORAGE_MODE=oss
OSS_BUCKET=<实际 Bucket>
OSS_ENDPOINT=https://oss-<实际地域>.aliyuncs.com
OSS_ECS_ROLE_NAME=miaomiao-points-backup-role
OSS_PREFIX=miaomiao/production
LOCAL_BACKUP_RETENTION_DAYS=7
```

## 回滚与故障

- 发布失败优先使用发布记录中的免费快照或上一个已验证镜像；先关闭积分发放/兑换入口并保留审计。
- 本地备份失败时保留最后一份已校验 dump，检查磁盘空间、PostgreSQL 和 SMTP 告警。
- OSS 配置失败不影响现有本地 dump；切回 `BACKUP_STORAGE_MODE=local`，再修复 IAM/Endpoint。
- 禁止通过删除已执行 migration 来恢复；恢复库只用于验证或经事故负责人批准的数据恢复。
- 恢复完成后运行积分余额、重复有效 `photoId`、订单金额和整数积分对账。

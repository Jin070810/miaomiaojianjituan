# 阿里云 OSS 备份与恢复手册

## 创建前确认

创建付费资源前必须从 ECS 元数据或控制台读取实际地域和账号 ID，不猜测。向批准人展示并确认：

- ECS 地域：`<实际 regionId>`
- Bucket：`miaomiao-points-prod-backup-<账号ID>-<地域ID>`
- Endpoint：`https://oss-<地域ID>.aliyuncs.com`
- 前缀：`miaomiao/production`
- 私有、阻止公共访问、版本控制、SSE-OSS AES256
- 生命周期：0–30 天标准，31–180 天低频或归档，180 天后删除当前版本；非当前版本也必须设置 180 天删除，避免版本控制导致历史备份永久计费
- 预计月费：按实际备份压缩大小乘以各存储阶段单价，加请求和恢复流量；在控制台价格计算器填写实际地域后截图确认

未取得本次操作的明确确认，不创建 Bucket、RAM 角色或生命周期规则。

## RAM 最小权限

实例角色命名为 `miaomiao-points-backup-role`，绑定 ECS，不创建长期 AccessKey。资源范围替换为实际 Bucket：

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

生产 `.env.production` 只增加：

```dotenv
OSS_BUCKET=<实际 Bucket>
OSS_ENDPOINT=https://oss-<实际地域>.aliyuncs.com
OSS_ECS_ROLE_NAME=miaomiao-points-backup-role
OSS_PREFIX=miaomiao/production
LOCAL_BACKUP_RETENTION_DAYS=7
```

## 每日备份

`Production OSS Backup` workflow 在 UTC 18:15，即上海时间 02:15 执行。它在 ECS 上运行 `pg_dump`，验证本地 SHA-256，通过 IMDSv2 获取实例角色临时凭据，上传 dump 与校验文件并设置 AES256，然后回下载再次计算 SHA-256。成功后写入 `backups/last-oss-success.json` 并清理超过 7 天的本地备份。

上传或校验失败会调用现有 SMTP/Webhook 告警；任何告警发送失败仍会让 workflow 失败。不得把 OSS AccessKey 写入 GitHub、服务器环境文件或仓库。

## 月度恢复演练

`Monthly OSS Restore Drill` 每月 2 日上海时间 02:45 执行：

1. 列出生产前缀并下载最新 dump 与校验文件。
2. 校验 SHA-256。
3. 启动隔离的临时 PostgreSQL 16 容器。
4. 使用 `pg_restore --no-owner --no-privileges` 恢复。
5. 在恢复库执行 `npm run data:reconcile` 和成员数量检查。
6. 删除临时数据库和下载目录。
7. 将脱敏输出保存为 365 天受保护 GitHub Actions artifact。

演练记录至少包含 run ID、执行时间、源 object key、SHA-256、对账结果、记录数量、操作者和结论。失败时先保留 workflow 日志与告警，再排查，不使用生产数据库作为恢复目标。

## 回滚与故障

- OSS 配置失败不影响现有本地 dump；先保留本机备份并修复 IAM/Endpoint。
- 禁止通过删除已执行 migration 来恢复；恢复库只用于验证或经事故负责人批准的数据恢复。
- Bucket 误删保护依赖版本控制和人工权限隔离；生命周期规则变更需双人复核。
- 恢复完成后运行积分余额、重复有效 `photoId`、订单金额和整数积分对账。

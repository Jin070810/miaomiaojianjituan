# 工程流程与发布规范

## 1. 工作项

所有开发先建立 Issue，写清楚背景、范围、验收条件、风险和是否涉及数据库/积分/权限。紧急安全问题可以走 Hotfix，但仍需补齐 Issue、审查和发布记录。

分支命名：

| 类型 | 示例 | 用途 |
| --- | --- | --- |
| `feature/` | `feature/recipient-profile` | 新功能 |
| `fix/` | `fix/video-reprocess-job` | 缺陷修复 |
| `security/` | `security/session-hardening` | 安全修复 |
| `chore/` | `chore/dependency-update` | 工程维护 |
| `hotfix/` | `hotfix/payment-order-lock` | 线上紧急修复 |

每项工作从最新 `main` 创建新分支。分支合并后删除，下一项工作必须重新建分支。

## 2. 开发阶段

1. 阅读 `AGENTS.md`、相关模块和现有测试，先写验收条件。
2. 采用现有 Next.js、Prisma、BullMQ 和 CSS 约定，避免引入重复抽象。
3. 涉及积分、订单、状态机、唯一约束或权限时，先写失败测试，再实现。
4. 数据库变更只新增 Prisma migration；本地先 `npm run db:deploy`，再运行数据库集成测试。
5. 不在代码中写入密钥、服务器密码、真实成员数据或飞书原始导出。
6. UI 变更需要覆盖移动端和桌面端截图，并保留可复现的验收步骤。

## 3. Pull Request

PR 必须填写 `.github/pull_request_template.md`，并包含：

- 变更目的、范围和非目标；
- 数据库/权限/积分/迁移/部署影响；
- 测试命令和结果；
- UI 前后截图或说明不适用；
- 回滚方式；
- 是否需要数据负责人或业务负责人确认。

审查重点按顺序是：资金和积分正确性、越权和敏感数据、并发幂等、数据迁移、可观测性、兼容性、用户体验。CI 全绿不代替人工审查。

## 4. Staging 验收

合并前或发布候选版本必须部署到独立 staging 数据库，使用脱敏数据。至少验证：

- 注册、登录、停用账号、管理员 RBAC 和密码重置；
- 长链接/短链接/分享文案提交、7 天边界、200 赞边界、作者不一致、重复 `photoId`、驳回后二次提交；
- 自动入账、管理员调整/撤销、转账并发、兑换库存并发、退款；
- 现金收款码、实物收货档案复用、周/月榜前五领奖；
- 390×844、1440×900 关键页面及 Redis/Worker 重启恢复。

验收记录写入发布单，附版本 commit、截图和失败项。

## 5. 正式发布

正式发布必须由人工确认以下条件后执行：

- PR 已合并到 `main`，commit 已打 tag；
- 生产管理员账号已确认，`/api/health` 返回 200；
- `SESSION_SECRET`、`PHONE_ENCRYPTION_KEY`、数据库密码和 Redis 配置已由密钥管理系统注入；
- HTTPS 证书、域名 DNS、备份和恢复演练通过；
- 飞书冲突报告已逐项确认，重复快手 ID 已决定保留记录；
- 监控、错误告警、Worker 失败告警和备份告警已接收；
- 发布窗口、负责人和回滚点已记录。

发布顺序：

1. 进入维护或限制高风险写操作；
2. 备份数据库并校验 `.sha256`；
3. 拉取已批准 commit，构建并扫描镜像；
4. 执行 `prisma migrate deploy`；
5. 启动/滚动更新 Web 和 Worker；
6. 检查 `/api/health`、登录、视频队列、积分账户和订单；
7. 解除维护并观察至少 30 分钟；
8. 记录发布结果和监控截图。

## 6. 回滚与事故

应用回滚：

```powershell
git fetch origin
git checkout <已批准的旧 release tag>
docker compose build app
docker compose up -d app worker
```

数据库恢复前必须停止 Web 和 Worker、核对备份校验值，并由技术负责人确认恢复时间点。若 migration 不可逆，不回退数据库，改用前向修复 migration。

出现积分错账、批量重复入账、越权或敏感信息泄露时，立即关闭视频提交/转账/兑换入口，保留日志和数据库快照，通知业务负责人和安全负责人，禁止直接改表修账。

## 7. 版本与变更记录

正式版本使用 `vMAJOR.MINOR.PATCH` tag。每次发布记录：

- 版本号和 Git commit；
- 变更摘要、migration 和配置变化；
- staging 验收人、人工批准人、发布人；
- 备份文件和校验值；
- 监控链接、已知问题和回滚点。

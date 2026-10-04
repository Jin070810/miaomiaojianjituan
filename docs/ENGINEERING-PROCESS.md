# 工程流程与发布规范

## 1. 工作项

所有开发先建立 Issue，写清楚背景、范围、验收条件、风险和是否涉及数据库/积分/权限。紧急安全问题可以走 Hotfix，但仍需补齐 Issue、技术验收和发布记录。按所有者 2026-10-04 的要求，日常发版全自动，无需所有者审核或逐次批准；本规则取代历史文档中的人工发布确认要求，不改变业务审批和数据库恢复权限。

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
- 自动验收结果和仍未满足的技术前提。

验收重点按顺序是：资金和积分正确性、越权和敏感数据、并发幂等、数据迁移、可观测性、兼容性、用户体验。开发代理完成实现、测试、风险记录后将 PR 设为就绪；自动化只合并同仓库可信写入者的非 Draft PR，使用精确 head SHA、最新成功 CI 和服务端分支保护。人工审查可自愿进行，不作为必需批准。失败的检查不会由机器人忽略或自批；见 [自动发版](AUTOMATIC-RELEASE.md)。

## 4. Staging 验收

合并前或发布候选版本必须部署到 staging 数据库，使用合成或脱敏数据；验收由自动化执行并留存记录，不得用正式生产数据代替。涉及历史数据的 migration 还须使用脱敏生产副本演练。至少验证：

- 注册、登录、停用账号、管理员 RBAC 和密码重置；
- 长链接/短链接/分享文案提交、7 天边界、200 赞边界、作者不一致、重复 `photoId`、驳回后二次提交；
- 自动入账、管理员调整/撤销、转账并发、兑换库存并发、退款；
- 现金收款码、实物收货档案复用、周/月榜前五领奖；
- 自动视频通过/驳回、作品作者 UID 与已验证绑定一致、昵称变化不影响归属、成员申诉、管理员申诉复查和申诉并发幂等；
- 390×844、1440×900 关键页面及 Redis/Worker 重启恢复；
- `npm run data:reconcile` 无余额、重复有效视频、库存或整数积分异常；
- `npm run smoke:concurrency` 默认以 20 并发请求 staging 健康接口，关键写入仍需使用测试账号做幂等验收。

验收记录写入发布单，附版本 commit、截图和失败项。

## 5. 正式发布

正式发布由成功的 main CI 自动触发，控制器校验以下条件；不等待维护者点击确认：

- PR 已合并到 `main`，commit 已打 tag；
- 部署 workflow 已验证 release SHA 是 `main` 的祖先，禁止从未合并分支直接发布；
- 生产管理员账号存在，`/api/health` 返回 200；
- `SESSION_SECRET`、`PHONE_ENCRYPTION_KEY`、数据库密码和 Redis 配置已由密钥管理系统注入；
- HTTPS 证书、域名 DNS、备份和恢复演练通过；
- 如涉及历史数据导入，冲突已解决且唯一性与对账检查通过；
- 监控、错误告警、Worker 失败告警和备份告警已接收；
- 自动执行者、时间和回滚点已记录。

发布顺序：

1. 进入维护或限制高风险写操作；
2. 备份数据库并校验 `.sha256`；
3. GitHub Actions 校验合并 SHA 对应的成功 main CI run 和签名 release manifest，自动分配或复用唯一版本 tag；生产按已验收 digest 拉取并校验 revision、镜像 ID，禁止在部署阶段重建；
4. 执行 `prisma migrate deploy`；
5. 启动/滚动更新 Web 和 Worker；
6. 检查 `/api/health`、登录、视频队列、积分账户和订单；
7. 解除维护，独立观察 job 检查同版本健康、登录页和前后积分对账，至少连续健康 30 分钟；不占用下次部署的并发锁；
8. 自动写入 GitHub Release 和部署/观察证据。被新部署接替的观察标记 superseded，不能冒充完整通过。

## 6. 回滚与事故

应用回滚通过 `Deploy Production` workflow 选择已验收旧 release commit 和对应成功 CI run ID，复用原 release manifest 中的 App/Worker digest。App 与 Worker 必须使用同一完整 SHA；workflow 和生产主机均不得为回滚重新构建。仍需执行来源及 migration 校验、digest 拉取、revision/镜像 ID 校验、发布前备份和健康检查。先评估当前数据库是否兼容旧应用；Actions artifact 过期时可显式使用已部署候选的签名留存，并验证原成功 CI attempt；缺少可信清单、CI 历史不可验证或 migration 不兼容时停止回滚，执行经过验收的前向修复，不能把临时重建伪装成原发布物。

数据库恢复前必须停止 Web 和 Worker、核对备份校验值，并由维护者确认恢复时间点。若 migration 不可逆，不回退数据库，改用前向修复 migration。

出现积分错账、批量重复入账、越权或敏感信息泄露时，立即关闭视频提交/转账/兑换入口，保留日志和数据库快照；有业务或安全负责人时通知其协同，禁止直接改表修账。

## 7. 版本与变更记录

正式版本使用 `vMAJOR.MINOR.PATCH` tag。每次发布记录：

- 版本号和 Git commit；
- 变更摘要、migration 和配置变化；
- staging 自动验收 run / attempt、发布自动执行者及 workflow；
- 备份文件和校验值；
- 监控链接、已知问题和回滚点。

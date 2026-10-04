# GitHub 仓库保护配置

以下设置遵循所有者 2026-10-04 的持续授权：日常自动合并、自动发布，无需所有者审核。可通过 GitHub 网页或受控 API 配置，配置后读取规则验证。main 保护和 production 精确 main 限制已于本次实施通过 API 核验；新增工作流仍需合并后验证实际运行。当前候选发布门禁见 [上线准备](../PRODUCTION-READINESS.md)。

## 主分支

1. 将默认分支设为 `main`。
2. 在 Settings → Branches / Rulesets 创建保护规则，目标为 `main`。
3. 启用：
   - Require a pull request before merging；
   - Required approvals：0，不设置人工批准前提；
   - 不要求 Code Owners approval；
   - Dismiss stale approvals when new commits are pushed；
   - Require status checks：本仓库 CI 的 `core`、`staging` 两个检查（GitHub 页面可能显示为 `CI / core`、`CI / staging`），不要继续选择已删除的 `test` 或独立 `e2e`；
   - Require conversation resolution；
   - 按合并策略设置 linear history；当前整合分支含合并提交，选择 squash 后 main 可保持线性；
   - Block force pushes；
   - Block deletions；
   - Do not allow bypassing the above settings。
4. 禁止直接 push 到 `main`，只允许 squash merge。

涉及积分、数据库、认证、安全和部署的 PR 仍须通过相应集成测试、迁移演练、staging 和回滚兼容性门禁。没有人工审查暂停点。CI checks 应绑定 GitHub Actions App，strict 保证基于最新 main 验证。

## Production Environment

在 Settings → Environments 新建 `production`：

1. Required reviewers 留空；
2. 不设置人工等待计时器，workflow 不保留 `confirm_production` 或维护者自审确认输入；
3. Deployment branches 只允许 `main`；
4. 配置 Secrets：
   - `PRODUCTION_HOST`
   - `PRODUCTION_USER`
   - `PRODUCTION_SSH_KEY`
5. 配置 Variables：
   - `PRODUCTION_PATH`
   - `PRODUCTION_DOMAIN`

服务器使用专用部署 SSH Key，关闭 root 密码远程登录；私钥只放 GitHub Environment Secret，公钥放服务器部署账号的 `authorized_keys`。

## 发布

1. 可信写入者的就绪 PR 通过 core/staging 后，由 Automatic Integration 通过保护规则合并；
2. 控制器显式触发 main CI，避免 GITHUB_TOKEN 事件递归限制造成漏跑；
3. 成功 main CI 自动触发 Deploy Production，校验精确 SHA、run/attempt 和最新 main；
4. 自动分配或复用唯一版本 tag，不等待人工批准；
5. main 的 `core`、`staging` 和 `publish` 必须全部成功，产物含验收镜像摘要与真实签名。PR 的 publish 正常跳过，不能作为发布凭证；
6. 部署工作流验证原制品，主机预检、维护、排空、备份、migration、同版本切换和 TLS 健康通过后恢复入口；服务器不再构建；
7. 独立观察 job 验证 30 分钟连续健康与前后积分对账，自动记录结果；详见 [自动发版](AUTOMATIC-RELEASE.md)。归档候选恢复及原 CI attempt 校验见 [签名与归档](SIGNED-RELEASE-ARCHIVE.md)。

工作流失败时不会自动回退数据库。按 migration 兼容性证据选择应用恢复或前向修复；不把失败重试变为无限自动循环。

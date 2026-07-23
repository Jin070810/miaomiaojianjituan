# GitHub 仓库保护配置

以下设置需要仓库所有者在 GitHub 网页完成一次。配置完成后，正式发布才能真正满足“分支开发、人工审查、自动测试、人工批准部署”。

## 主分支

1. 将默认分支设为 `main`。
2. 在 Settings → Branches / Rulesets 创建保护规则，目标为 `main`。
3. 启用：
   - Require a pull request before merging；
   - Required approvals：至少 1；
   - Require review from Code Owners；
   - Dismiss stale approvals when new commits are pushed；
   - Require status checks：`CI / test`；
   - Require conversation resolution；
   - Require linear history；
   - Block force pushes；
   - Block deletions；
   - Do not allow bypassing the above settings。
4. 禁止直接 push 到 `main`，只允许 squash merge。

涉及积分、数据库、认证、安全和部署的 PR，建议人工要求 2 个批准。

## Production Environment

在 Settings → Environments 新建 `production`：

1. 如果仓库套餐支持，Required reviewers 添加业务负责人和技术负责人；
2. 如果当前私有仓库套餐不支持 Environment protection，正式 workflow 的 `confirm_production` 输入必须保持默认 `false`，只有发布负责人明确勾选 `true` 才能继续；
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

1. PR 合并到 `main` 后记录完整 commit SHA；
2. Actions → Deploy Production → Run workflow；
3. 输入已合并的 40 位 commit SHA，并明确勾选 `confirm_production`；
4. 如果配置了 Environment 审查者，等待人工批准；
5. 工作流备份数据库、构建并部署；
6. `/api/health` 通过后记录发布结果。

工作流失败时不会自动回退数据库。由技术负责人根据 migration 情况决定应用回滚或前向修复。

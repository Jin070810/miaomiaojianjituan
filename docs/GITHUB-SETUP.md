# GitHub 仓库保护配置

以下设置需要仓库所有者在 GitHub 网页完成一次。配置完成后，正式发布满足“分支开发、自动测试、维护者自审或多人审查、显式批准部署”。

## 主分支

1. 将默认分支设为 `main`。
2. 在 Settings → Branches / Rulesets 创建保护规则，目标为 `main`。
3. 启用：
   - Require a pull request before merging；
   - Required approvals：单人维护仓库设为 0，多人协作仓库设为至少 1；
   - 不要求不存在的 Code Owners；多人协作时可按实际团队配置；
   - Dismiss stale approvals when new commits are pushed；
   - Require status checks：`CI / test`；
   - Require conversation resolution；
   - Require linear history；
   - Block force pushes；
   - Block deletions；
   - Do not allow bypassing the above settings。
4. 禁止直接 push 到 `main`，只允许 squash merge。

涉及积分、数据库、认证、安全和部署的 PR，多人协作时建议要求 2 个批准；单人维护时必须完成 PR 自审清单、staging 验收和回滚确认。

## Production Environment

在 Settings → Environments 新建 `production`：

1. 多人协作且有负责人时，Required reviewers 添加业务负责人和技术负责人；单人维护时可以不配置 Required reviewers，保留 workflow 的显式确认；
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
4. 如果配置了 Environment 审查者，等待人工批准；单人维护且未配置审查者时，以 workflow 的维护者确认和发布记录为准；
5. 工作流备份数据库、构建并部署；
6. `/api/health` 通过后记录发布结果。

工作流失败时不会自动回退数据库。由技术负责人根据 migration 情况决定应用回滚或前向修复。

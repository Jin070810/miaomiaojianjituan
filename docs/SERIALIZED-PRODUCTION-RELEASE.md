# 生产发布主机互斥与阶段记录

关联 #105，依赖不可变候选镜像链路。此变更提交审查时尚未合并或上线。

## 发布契约

Deploy Production 先在 GitHub runner 验证已合并 SHA、唯一正式版本 tag、成功的 main CI run、manifest、镜像摘要与 migration 清单，然后通过一次 SSH 数据流执行完整发布。服务器不执行 Docker build。

服务器以项目绝对路径下的 `.production.lock` 为互斥锁，最多等 120 秒。配置更新、源码切换、镜像校验、备份、迁移、管理员初始化、App/Worker 更新、Nginx 配置检查与 reload、HTTPS 验证和成功记录均持有同一 FD 锁。发布控制器最多运行 30 分钟，各 Docker、Git、网络步骤另有较短期限；锁由子进程继承，不能通过杀死调用者就允许另一个发布越过仍在工作的子进程。

备份、恢复演练、日常巡检、订单维护的 SSH 入口使用同一路径的锁；手动 Linux `backup-db.sh`、`restore-db.sh` 和兼容的镜像标签命令也取得该锁。手动执行其他 Docker/Git 命令不自动受保护，生产维护必须使用受控入口。旧 `deploy-production.sh` 的裸备份/启动入口已停用。

订单维护不再切换生产 checkout、不再从宿主机挂载临时 TypeScript 覆盖镜像代码。它核对 checkout SHA 和实际 Worker 镜像 revision，随后使用该运行镜像中的维护脚本。一个发布失败后，若源码与运行镜像不一致，维护命令会拒绝执行。

## 阶段与失败处理

| 阶段 | 行为 | 失败处理 |
| --- | --- | --- |
| verify_host / source | 保存当前 SHA、实际容器镜像 ID，检查当前健康与源码无修改，校验目标 main 祖先 | 不启动新服务；记录失败 |
| capacity_before_pull / capacity_after_pull | 源码/镜像变更前及拉取后，检查项目、镜像存储、数据库文件系统的空间和inode；至少3GiB，数据库较大时提高至其大小3倍+1GiB | 停在维护前，保留当前正常服务；不自动扩大清理范围 |
| config_validate / images | 在私有文件中一次组装配置、预检；拉取并校验两个镜像，暂不更新 production 标签 | 原 `.env.production` 不变，恢复原 checkout |
| dependencies | 依赖就绪 | 不修改旧版本运行状态 |
| migration_check | 对比数据库已执行迁移和目标清单 | 同名 checksum 不符始终拒绝；仅目标版本缺少已执行迁移时，可附明确的应用兼容性评估 |
| candidate_preflight | 无宿主机端口的一次性候选 App，验证 ready、SHA、登录静态资源和图片优化 | 预检失败不关闭正常入口；销毁一次性容器 |
| maintenance / drain / database_quiescence | TLS 入口显示维护页，校验 503 和专用响应头；停止旧 Web/Worker，检查退出状态和数据库其他客户端 | 迁移前仅恢复确切的旧容器；原版本健康无法确认则保持维护 |
| backup / offsite_backup | 排空后执行 pg_dump、pg_restore 目录验证、SHA-256；OSS 模式额外上传并回读验证 | 不执行 migration；不保留不完整备份为可用结果 |
| config_commit / migrate | 原子替换配置，显式运行本版本 migrate 容器 | 迁移开始前恢复配置；迁移开始后保留现场，禁止自动回退数据库或应用 |
| administrator / application | 仅明确勾选时初始化管理员；用 digest 启动 Web/Worker | 清理本次命名的一次性容器，记录失败；不写成功指针 |
| local_health / ingress / public_health / reopen | 保持维护；本机同 SHA 完整健康；Nginx `-t` 后 reload；HTTPS 同 SHA 健康，延期告警时验证周挑战关闭；最后开放登录入口 | 迁移后失败重新关闭入口并停止当前写入进程，不自动降级数据库或应用 |
| record / completed | 更新兼容 production 标签、current/previous 清单，标记 succeeded | 所有检查通过才到达成功状态 |

`migration_compatibility_note` 只能说明旧应用为什么兼容当前数据库，不授权删除表、重写 migration 或数据库恢复。目标中仍存在的已执行 migration 被修改时，即使填写说明也不能放行。SQL 清单查询会在配置提交和 migration 之前执行。

Nginx 使用可信控制器附带的配置，挂载 `.release-runtime/` 整个目录。维护标记原子更新后每次请求检查文件，避免单文件 bind mount 仍指向旧 inode。首次从旧配置切换需要重建 Nginx，后续通常 reload。预检容器随后销毁，正式 App/Worker 仍替换原服务；预检不等于复用已预热进程。维护窗口包括排空、备份、迁移和健康检查，不能承诺零停机。[Docker bind mount](https://docs.docker.com/engine/storage/bind-mounts/)、[Nginx 文件检查与 return](https://nginx.org/en/docs/http/ngx_http_rewrite_module.html#if)。

维护期间仅精确的只读 `GET/HEAD /api/health` 可达，其他页面和 API（含旧版可能带写入副作用的 GET）统一返回 503、`Retry-After: 30` 和 `Cache-Control: no-store`。App 3000 端口仍只绑定宿主机回环地址；宿主机的手动 SQL、直接 Docker 命令必须遵守工程维护互斥，入口维护不是数据库写权限隔离。

每个旧容器按完整 ID 和 Compose 项目/服务标签核验，`docker stop --time 75` 后复核退出、OOM 和运行状态。不能用 Docker stop 命令成功代替排空完成。Worker supervisor 只接受子进程明确返回 0，超时、信号退出和清理异常均失败。当前锁定的 Next.js 在 `server.close()` 等待请求结束后显式退出 143，因此 Web 接受 0/143；这个约定必须通过真实请求收尾演练验证，不能推广到任意旧镜像。其后还要求业务数据库没有其他客户端连接（包括空闲连接），不会自动杀死陌生会话。[Docker stop 超时行为](https://docs.docker.com/reference/cli/docker/container/stop/)。

迁移开始前发生失败：恢复配置/checkout，必要时启动所记录的确切旧容器；只有它在发布进入时健康、恢复后本机和 TLS 同版本健康均通过，才解除维护。已有失败状态下无法确认原版本健康则继续维护。迁移开始后任何失败都保持维护，停止当前 App/Worker，保留现场，由维护者评估前向修复。此控制器要求已有 App/Worker，空主机首次安装另行验收。

## 发布证据与秘密

每次尝试保留 `releases/attempts/<run>-<attempt>/`：

- `journal.json`：版本 tag、目标/原 SHA、操作者、时间、manifest 哈希、当前阶段、退出码，以及配置是否提交、迁移是否已经开始。
- `events.jsonl`：阶段时间点，可计算每段耗时。
- `manifest.json`、`previous.json`、`previous-app/worker/nginx.json`：候选和实际旧镜像依据。
- `backup.json`、`migrations-before.json`、本机/HTTPS 健康结果；如适用，兼容性评估和 OSS 备份结果。
- `candidate-preflight.json`、维护响应头、`drain-app/worker.json`、`database-quiescence.json`；失败时另存恢复或停写证据。容器证据仅白名单字段，不记录环境变量。

`releases/active.json` 原子更新；发现上次 failed 或残留 running 时，下一次必须先核对记录，再使用原有 `recover_from_failed_release` 确认。重复 run/attempt 拒绝覆盖记录。SIGKILL/主机断电可能留下 running，不能据此认为成功。

GHCR token 和可选管理员密码仅通过私有 stdin 载荷传输，不出现在 SSH argv 或上传的证据中。环境文件不作为 shell 执行。原配置和候选配置位于 `.release-private/<attempt>/`，目录 700、文件 600；不进入 Git、Docker context 或 Actions artifact。该目录供故障恢复核对，清理前须由运维确认不再需要。备份数据也不上传到发布证据 artifact。

已部署候选的 manifest 和签名 bundle 按原 CI run/attempt 成对留存，过期 artifact 可使用显式签名归档入口，仍需原成功 CI attempt 验证，见 [签名留存与恢复](SIGNED-RELEASE-ARCHIVE.md)。旧 v1.11.0 等没有 manifest 的发布仍需独立可信基线和原镜像排空验证；不得用旧容器 ID 截图替代来源验证，也不得把同 SHA 重建物当成原镜像。

## 验收

本地 `scripts/test-production-release.sh` 使用真实 Git、flock 和文件系统，隔离模拟 Docker/网络失败；覆盖 13 个失败阶段、强制终止、数据库残留连接、无法恢复健康、成功、重复尝试、未确认故障恢复、两种迁移冲突、显式兼容回滚、秘密不进入证据、配置不作为 shell 执行、原配置权限和并发主机锁。`test-release-lifecycle.sh` 另测 OOM、错误容器身份、维护文件符号链接和实际 CRLF 响应头处理。

CI staging 另执行 `test-staging-release-controller.sh`：仅 `CI=true`、显式开关和 `miaomiao_staging` 数据库允许进入。使用临时仓库、合成密钥、真实预检、pg_dump/目录校验、迁移、App/Worker 和本机 TLS Nginx 入口。在旧 App 保持一个尚未传完的无效登录请求，发送 SIGTERM 后确认进程仍等待，再完成请求并断言返回 400。维护页用 Playwright 检查 390×844 与 1440×900、刷新按钮、页面无横向溢出和 API 阻断。PR 无 registry 写权限，因此仅将 fixture 镜像路径映射到本次已经构建的实际 image ID；不模拟 Compose、数据库、容器启动或健康请求。新增演练须以该 PR 的 CI 成功结果为准；不代表脱敏生产副本恢复或已上线。

部署主机需要 Bash、Git、Docker Compose、jq、OpenSSL、GNU timeout、flock、realpath、tar 和 sha256sum。上线前仍须通过 staging、备份/恢复、证书、密钥及回滚兼容性检查。按所有者 2026-10-04 要求，这些检查由自动化执行，不要求维护者自审或逐次批准；见 [自动发版](AUTOMATIC-RELEASE.md)。

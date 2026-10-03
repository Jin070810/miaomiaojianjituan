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
| config_validate / images | 在私有文件中一次组装配置、预检；拉取并校验两个镜像，暂不更新 production 标签 | 原 `.env.production` 不变，恢复原 checkout |
| dependencies / backup | 依赖就绪；pg_dump 临时文件、pg_restore 目录验证、SHA-256；OSS 模式额外上传并回读验证 | 不执行 migration；不保留不完整备份为可用结果 |
| migration_check | 对比数据库已执行迁移和目标清单 | 同名 checksum 不符始终拒绝；仅目标版本缺少已执行迁移时，可附明确的应用兼容性评估 |
| config_commit / migrate | 原子替换配置，显式运行本版本 migrate 容器 | 迁移开始前恢复配置；迁移开始后保留现场，禁止自动回退数据库或应用 |
| administrator / application | 仅明确勾选时初始化管理员；用 digest 启动 Web/Worker | 清理本次命名的一次性容器，记录失败；不写成功指针 |
| local_health / ingress / public_health | 本机同 SHA 完整健康；Nginx `-t` 后 reload；HTTPS 同 SHA 健康，延期告警时验证周挑战关闭 | 不记成功；不盲目自动回滚 |
| record / completed | 更新兼容 production 标签、current/previous 清单，标记 succeeded | 所有检查通过才到达成功状态 |

`migration_compatibility_note` 只能说明旧应用为什么兼容当前数据库，不授权删除表、重写 migration 或数据库恢复。目标中仍存在的已执行 migration 被修改时，即使填写说明也不能放行。SQL 清单查询会在配置提交和 migration 之前执行。

Nginx 正常更新使用 reload，避免每次无条件 restart。App/Worker 当前仍使用原服务替换，尚未实现候选预热或流量双槽切换，不能据此承诺零停机。健康端点拆分在独立 PR 中验证，集成时一并验收。

## 发布证据与秘密

每次尝试保留 `releases/attempts/<run>-<attempt>/`：

- `journal.json`：版本 tag、目标/原 SHA、操作者、时间、manifest 哈希、当前阶段、退出码，以及配置是否提交、迁移是否已经开始。
- `events.jsonl`：阶段时间点，可计算每段耗时。
- `manifest.json`、`previous.json`、`previous-app/worker/nginx.json`：候选和实际旧镜像依据。
- `backup.json`、`migrations-before.json`、本机/HTTPS 健康结果；如适用，兼容性评估和 OSS 备份结果。

`releases/active.json` 原子更新；发现上次 failed 或残留 running 时，下一次必须先核对记录，再使用原有 `recover_from_failed_release` 确认。重复 run/attempt 拒绝覆盖记录。SIGKILL/主机断电可能留下 running，不能据此认为成功。

GHCR token 和可选管理员密码仅通过私有 stdin 载荷传输，不出现在 SSH argv 或上传的证据中。环境文件不作为 shell 执行。原配置和候选配置位于 `.release-private/<attempt>/`，目录 700、文件 600；不进入 Git、Docker context 或 Actions artifact。该目录供故障恢复核对，清理前须由运维确认不再需要。备份数据也不上传到发布证据 artifact。

已部署候选的 manifest 和签名 bundle 按原 CI run/attempt 成对留存，过期 artifact 可使用显式签名归档入口，仍需原成功 CI attempt 验证，见 [签名留存与恢复](SIGNED-RELEASE-ARCHIVE.md)。旧 v1.11.0 等没有 manifest 的发布仍需独立可信基线；不得用旧容器 ID 截图替代来源验证。首次基线、候选预热和流量切换仍在全量实施范围内。

## 验收

本地 `scripts/test-production-release.sh` 使用真实 Git、flock 和文件系统，隔离模拟 Docker/网络失败；覆盖 8 个失败阶段、成功、重复尝试、未确认故障恢复、两种迁移冲突、显式兼容回滚、秘密不进入证据、配置不作为 shell 执行、原配置权限和并发主机锁。

CI staging 另执行 `test-staging-release-controller.sh`：仅 `CI=true`、显式开关和 `miaomiao_staging` 数据库允许进入。使用临时仓库、合成密钥、真实 pg_dump/目录校验、迁移、App/Worker 和本机 TLS Nginx 入口。PR 无 registry 写权限，因此仅将 fixture 镜像路径映射到本次已经构建的实际 image ID；不模拟 Compose、数据库、容器启动或健康请求。该演练不代表脱敏生产副本恢复或已上线。

部署主机需要 Bash、Git、Docker Compose、jq、OpenSSL、GNU timeout、flock、realpath、tar 和 sha256sum。上线前仍须维护者完成原有自审、staging、备份/快照、证书、密钥及回滚点确认。

# 发布流水线

## 目标

- 一个 PR commit 只执行一次 PR CI；合并到 `main` 后再执行一次主分支 CI。
- 同一 PR 的旧 CI 自动取消，避免重复占用构建时间。
- 正式发布不经 SSH 传输完整 App/Worker 镜像，也不在生产主机执行构建。
- GitHub Actions 只构建已经合并到 `main` 且由发布人明确确认的完整 commit SHA。
- Docker 依赖下载使用 BuildKit GitHub Actions cache；依赖未变化时复用镜像层。
- 生产只按 GHCR digest 拉取镜像，并校验 OCI revision 与 release commit 一致。
- 镜像构建成功后才执行数据库备份、migration 和容器切换。
- App 切换后刷新 Nginx，避免旧容器 IP 缓存导致 502。

常规目标是 PR CI 不重复运行、缓存命中的 Actions 镜像构建在 5 分钟内完成、生产镜像拉取、容器切换和健康检查在 5 分钟内完成。首次安装依赖或基础镜像变化允许更久，但不得让构建负载影响生产服务。

## 流程

1. PR 的 `pull_request` 事件执行完整 CI；功能分支的普通 `push` 不再重复触发同一套检查。
2. 合并到 `main` 后执行主分支 CI，形成可发布 commit。
3. 发布人输入完整 SHA，并确认 staging、备份、证书和回滚点。
4. workflow 验证 SHA 是 `origin/main` 的祖先。
5. GitHub Actions 使用 BuildKit 构建 App/Worker，将完整 SHA 写入 OCI revision，并推送 GHCR。
6. workflow 在任何生产变更前检查当前 App、Worker、Database 和 Redis 健康。
7. workflow 通过专用 `deploy` SSH 账号进入生产服务器，使用短时 GitHub token 按 digest 拉取镜像。
8. 生产校验 App/Worker OCI revision 均等于批准 SHA 后，才标记本地 `production` 镜像。
9. 生产前置检查通过后备份数据库并校验 SHA-256。
10. Compose 执行 migration，切换 App/Worker，刷新 Nginx。
11. 外部 HTTPS `/api/health` 必须确认 Database、Redis、Worker、Queue 和 release SHA 正常。

## 周挑战开关

周挑战首次启用或恢复发放时，使用 `Weekly Challenge Production Switch` workflow，不直接修改生产数据库。输入当前生产完整 commit SHA、成功的 `Weekly Challenge DeepSeek Shadow` run ID，选择 `enabled=true` 并确认生产变更。workflow 会验证双周期 300 人影子报告、奖励预算、最终失败批次、App/Worker SHA、DeepSeek 配置和健康状态，再通过管理员 API 更新开关并写入审计日志。

紧急停止时运行同一 workflow 并选择 `enabled=false`；关闭路径不依赖历史影子 artifact 或健康全绿，只要求管理员 API 成功并确认开关已关闭。关闭后不激活新周期、不允许领取个人奖励，也不发放竞速奖励；历史任务和审计记录保留。

生产 SSH 只允许密钥认证。日常发布使用专用 `deploy` 账号；不得在 workflow 或仓库中保存 root 密码、私钥或服务器 `.env.production`。

## 为什么使用 GHCR digest

当前 App 和 Worker 解压后合计约 1.8GB，其中 Worker 的 `node_modules` 层约 837MB。`docker save | gzip | ssh | docker load` 每次都会发送完整归档，无法利用生产服务器已有层；在低带宽链路下单次传输可超过一小时。

生产主机只有 2 vCPU / 4 GiB。2026-08-04 的发布在生产本机执行 Next.js 类型检查时耗尽资源，导致旧服务和 SSH 同时失去响应，最终需要实例重启。构建发布镜像因此被定义为生产主机禁止操作。

GHCR 只传输缺失镜像层，Actions 构建缓存与生产运行资源完全隔离。部署使用构建输出 digest，而不是可变 tag；生产拉取后还会校验 OCI revision，避免 tag 漂移或 App/Worker 版本不一致。GHCR 凭据使用单次 workflow 的短时 token，并放在临时 Docker 配置目录中，步骤结束即删除。

## 依据

- [Docker: Optimize cache usage in builds](https://docs.docker.com/build/cache/optimize/)
- [Docker: GitHub Actions cache backend](https://docs.docker.com/build/cache/backends/gha/)
- [Docker: Multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
- [Docker: Building best practices](https://docs.docker.com/build/building/best-practices/)
- [GitHub: Control workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [GitHub: Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

## 后续优化

- 将 Worker 拆成独立运行时依赖，移除 Next.js、测试和 TypeScript 开发依赖，目标镜像小于 400MB。
- 记录每次 CI、生产构建、备份、migration、切换和健康检查的持续时间。
- 将生产部署拆成预发布、migration 和流量切换三个可独立观测的阶段。

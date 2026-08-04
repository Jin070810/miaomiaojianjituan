# 2026-08-04 生产构建资源耗尽事故

## 摘要

2026-08-04 18:13（Asia/Shanghai）发布 `v1.8.4` 时，`Deploy Production` 在生产轻量服务器本机执行 App/Worker Docker 构建。Next.js 编译在 17.7 秒内完成，但 TypeScript 检查持续占用资源，构建步骤在 30 分钟后超时。期间线上健康接口和 SSH 均无响应。18:52 下发实例重启，19:03 旧版服务恢复。

本次没有执行 deployment、Prisma migration 或新容器切换。恢复后 App/Worker 仍为 `353e8f2f2fa02b9236acee98199626076364f8e2`，Database、Redis、Worker 和队列均正常。

## 影响

- `https://miaoyi.site/api/health` 和用户请求超时。
- SSH 无法完成 banner 握手，常规远程止损不可用。
- `v1.8.4` 未发布；周挑战韧性修复尚未进入生产。
- 没有证据表明业务数据被修改；migration 步骤被 workflow 跳过。

## 根因

直接原因是 2 vCPU / 4 GiB 生产主机同时承载在线 App、Worker、PostgreSQL、Redis、Nginx 和 Next.js/Docker 构建。类型检查触发持续资源争抢，旧服务无法获得足够 CPU/内存。

系统原因是发布实现发生配置漂移：`scripts/deploy-production.sh` 和发布文档已经假设镜像由 CI 构建并验证，但 `.github/workflows/deploy-production.yml` 仍保留生产机本地构建步骤。workflow 超时终止 SSH 客户端，也不能可靠保证远端 BuildKit 子进程立即停止。

## 恢复

1. 确认构建步骤超时，deployment、migration、Ingress 和最终健康检查均未执行。
2. 连续公网健康检查与 SSH 握手确认主机资源饥饿。
3. 通过阿里云轻量应用服务器控制台重启实例。
4. 确认实例恢复“运行中”，公网健康接口返回 HTTP 200。
5. 核对 App/Worker 仍为上一发布 commit，Database、Redis、Worker 和队列正常。

## 长期修复

- 禁止在生产主机构建 App/Worker 发布镜像。
- GitHub Actions 使用 BuildKit 和 `type=gha` cache 构建并推送 GHCR。
- 生产使用短时 token 按不可变 digest 拉取镜像。
- App/Worker 镜像的 OCI revision 必须同时等于批准的完整 release SHA。
- 在 SSH、配置注入、migration 或容器切换前执行当前生产健康门禁。
- 镜像构建失败只能影响 Actions，不得消耗生产运行资源。

## 发布与回滚

- 失败 workflow：`30899741549`。
- 失败发布 commit：`325fd4de31b70a4e365ffd6141d1b578c9b0ae1b`。
- 恢复后的应用回滚点：`v1.8.3`。
- 本次未执行 migration；重新发布时仍按追加式 migration 和前向修复原则处理。

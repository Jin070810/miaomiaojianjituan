# 生产历史镜像保留

`Production Image Retention` 仅允许从主分支运行，默认 `inspect`，与发布共用生产互斥锁。它不会停止服务或修改数据库、卷、备份及代码。

保留所有容器（含停止的容器）引用的版本及其 App/Worker 配对、最近三组可识别的项目版本、带 `production` 标签的版本。来源未知、带其他仓库引用、无法通过 GHCR 原始 digest 验证恢复来源的镜像均保留。

版本识别优先使用 OCI revision 标签；旧 Dockerfile 已写入 `APP_COMMIT_SHA`，缺少标签时可使用该构建环境字段中的完整 40 位 SHA。两者冲突、重复环境值冲突或格式不符均保留，不猜测版本。只读取这个明确字段，不输出完整镜像环境。inspect 报告同时列出项目镜像被排除的原因。

生产 inspect `37181353099` 证明旧镜像已有有效 OCI 版本号，零候选的原因在引用格式。Docker 29.6.2 的 containerd 存储会将 digest 引用同时返回在 `RepoTags` 与 `RepoDigests`，见 [Moby 对应版本实现](https://github.com/moby/moby/blob/docker-v29.6.2/daemon/containerd/image_inspect.go#L146)。筛选器接受两数组中完全相同、属于本项目的 digest 别名，仍逐个验证 GHCR 可恢复性；未知或不同 digest 的引用继续保留，删除列表去重。

`clean` 仅对超过 14 天的其余项目镜像逐个执行无强制、无父镜像清理的 `docker image rm --no-prune`，达到 6 GiB 可用空间后停止。每次删除前复核容器引用和镜像 ID；前后核对所有容器、未选择镜像、卷、备份元数据、生产 commit 和公共健康状态。禁止通用 image/system/volume prune。删除镜像可按报告中的原始 digest 从 GHCR 恢复。

工作流凭证仅用于临时 Docker 配置和私有负载，退出清除；报告不含凭证、生产行数据或容器环境变量。首次维护先检查 inspect 报告，再执行 clean；未来可以由发布流程在相同约束下调用。

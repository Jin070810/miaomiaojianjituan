# Docker 镜像身份兼容

生产只读 run `37176569815` 实测 Docker29.6.2、overlayfs/containerd snapshotter。相同 v1.11.0 原镜像在传统CI的 `.Id` 是配置digest，而生产 `.Id` 是注册表manifest digest。直接比较字符串会误拒绝同一内容。

拉取仍只使用签名清单绑定的不可变 `image@sha256:...`，并验证OCI revision。仅当两边ID之一等于该固定manifest digest时，额外读取同一不可变注册表manifest，要求schemaVersion2、单平台OCI/Docker镜像manifest，以及配置digest与另一边ID精确一致。任意不匹配、manifest列表或错误配置仍拒绝。字段 `configId` 为早期清单命名，保留兼容；其值是staging验收的Docker镜像ID。

原镜像资格矩阵使用与生产相同Docker29.6.2，分别启用与关闭containerd snapshotter，验证原digest映射并执行真实隔离排空。只是证明环境差异下同一内容，没有重建原镜像、修改生产Docker或绕过发布来源验证。

Docker设置依据：[setup-docker-action 官方说明](https://github.com/docker/setup-docker-action#daemon-configuration)。

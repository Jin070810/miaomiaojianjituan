# Docker 镜像身份兼容

生产只读 run `37176569815` 实测 Docker29.6.2、overlayfs/containerd snapshotter。相同 v1.11.0 原镜像在传统CI的 `.Id` 是配置digest，而生产 `.Id` 是注册表manifest digest。直接比较字符串会误拒绝同一内容。

拉取仍只使用签名清单绑定的不可变 `image@sha256:...`，并验证OCI revision与linux/amd64平台。发生ID表示差异时，读取同一不可变注册表descriptor；若为OCI index/Docker manifest list，必须有且仅有一个linux/amd64描述符，再按其固定digest取得image manifest和config.digest。两边ID必须属于这一条完整内容链（根index/manifest、所选平台manifest、config）。不接受任意其他ID、错误平台、重复平台或错误配置。字段 `configId` 为早期清单命名，保留兼容；其值是staging验收的Docker镜像ID。

原镜像资格矩阵使用与生产相同Docker29.6.2，分别启用与关闭containerd snapshotter，验证原digest映射并执行真实隔离排空。只是证明环境差异下同一内容，没有重建原镜像、修改生产Docker或绕过发布来源验证。

Docker设置依据：[setup-docker-action 官方说明](https://github.com/docker/setup-docker-action#daemon-configuration)。

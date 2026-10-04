# 生产磁盘容量恢复

关联 #105。2026-10-04 只读 run `37176569815` 发现：项目磁盘可用约121MiB，Docker镜像约32.98GB、构建缓存约11.39GB（报告可回收6.231GB）。数据库约65MB，备份目录约170MB。低磁盘容量足以阻止拉镜像、写备份和数据库正常增长。

`Reclaim Old Production Build Cache` 仅允许受保护 main 的可信脚本通过现有 production SSH 连接运行。取得主机独占发布锁后，限定本机 default/docker 构建器，选取超过7天、未使用、未共享、regular/exec.cachemount 类型的缓存，再按确切 ID 集合与同样的年龄/使用/共享过滤器执行 BuildKit 回收。不会调用 image/container/volume/system prune，不删除回滚镜像、数据库卷、备份或服务器源码。

执行前后检查五个生产服务容器ID、镜像ID、启动时间、全部镜像与卷清单、备份目录元数据不变；公共健康和Web/Worker版本一致。仅输出空间变化、缓存ID、类别、大小及布尔检查结果。缓存可以按锁定依赖重新构建；清理不改变运行服务。若空间仍不足3GiB，报告失败，不自动扩大删除范围。

这是依据实际磁盘证据进行的一次容量修复。完整自动发版由整合分支提供；合并本脚本不会自动升级线上应用。

过滤器依据：[Docker Buildx prune 官方说明](https://github.com/docker/buildx/blob/master/docs/reference/buildx_prune.md)、[Docker Buildx du 官方说明](https://github.com/docker/buildx/blob/master/docs/reference/buildx_du.md)。

兼容修正：首次run `37177628857` 选择结果为空，没有执行prune，所有受保护资源及健康保持不变。核对[BuildKit字段适配源码](https://github.com/moby/buildkit/blob/master/cache/manager.go)后，改用 `private=""` 匹配存在的私有记录，不能把布尔存在字段写成 `shared=false` 或 `inuse=false`。`du` 只列出候选，7天年龄由 `prune` 的KeepDuration执行，活跃记录由BuildKit自身保护。新增真实scratch构建缓存CI测试，验证年轻缓存不被7天过滤删除、精确ID回收及镜像保留，避免仅凭mock确认CLI语义。

# 原 v1.11 镜像排空资格验证

关联 #105。验证原发布 run `36514915183`、SHA `752b084ec220ce5c827609611e51ce718b28b92d` 的实际 App/Worker digest。来源同时由原部署日志和版本记录核对；从 GHCR 拉取原 digest，不重建，也不伪造当时不存在的新版签名清单。

`Original v1.11 Image Qualification` 只在隔离 GitHub runner 执行。同仓库 PR 可测试资格脚本，main 可手动重验；仅给予当前仓库 packages/actions 读取权限，没有 production Environment、SSH 凭据或镜像写权限。

验证使用内部 Docker 网络、随机合成密码、空 PostgreSQL 16/Redis、原镜像自身的 migrations 和虚构管理员。Web 没有宿主机端口，探针与请求客户端均在同一内部网络，Worker 无外网。需要实际证明：

1. 两个原始 digest 的 OCI revision 符合历史发布 SHA，App/Worker 启动后健康和版本一致。
2. 在隔离数据库持有有界表锁，让引用不存在视频的真实 BullMQ 任务处于处理中。发送 Worker SIGTERM 后进程必须等待锁释放及任务完成，不能仅以 docker stop 命令成功作为排空依据。任务不会抓取平台、写成员或发积分。
3. 旧 Web 正在接收合成无效登录请求时发送 SIGTERM；进程应等待请求收完并返回 400，再退出。
4. Worker 显式退出 0；Web 退出 0 或固定 Next 版本的 143；无 OOM，两个进程停止后数据库没有残留客户端。

只保留镜像来源、退出状态和合成断言 JSON。容器、内部网络和私有合成凭据退出即清理。不得在生产运行这个表锁、队列注入或停容器测试。

实际运行结果见 PR/Actions；脚本存在不等于资格通过。若原镜像不满足排空标准，应按实际失败行为设计首次切换，不能放宽所有后续发布门禁。通过本验证也不使旧版成为新签名入口可直接回滚的候选，数据库兼容性和生产副本迁移仍须另行验证。

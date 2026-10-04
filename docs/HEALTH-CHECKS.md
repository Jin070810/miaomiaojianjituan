# Web 健康与运维诊断边界

Web 容器过去以完整 `/api/health` 作为自身健康检查。该接口查询 Worker、队列、周挑战与管理员；Worker 重启或后台调度异常会使 Web 被标记为不健康，Nginx 的健康依赖也可能因此阻止入口启动。

## 三类检查

| 地址 | 判断范围 | 使用位置 |
| --- | --- | --- |
| `/api/health/live` | 当前进程能处理 HTTP 请求，附运行版本及时间；不访问数据库、Redis、Worker 或配置诊断 | 进程存活诊断 |
| `/api/health/ready` | 配置合法、共享数据库连接可查询、Redis 限流存储可用 | Compose Web healthcheck，后续预热/流量切换的 Web 就绪门禁 |
| `/api/health` | 保留原有详细字段；额外检查 Worker、同版 SHA、管理员、队列、周挑战配置与调度 | 现有生产发布验收、每日运维和告警 |

所有接口使用运行时处理并返回 `Cache-Control: no-store, max-age=0`。生产环境缺少 Redis 或关键配置仍会使 Web 就绪检查返回 503。Worker 不可用时，Web 可以继续提供页面和查询，但详细运维接口返回 503。发布验证仍要求 App/Worker 的完整 SHA 与目标版本一致，不能用 `/live` 或 `/ready` 的 200 替代完整发布验收。

周挑战周期缺失或失败等业务降级继续显示 `degraded` / `operationalIssues`，不改写为 Web 不可用。诊断无法读取视频队列时明确返回失败，不再把缺少状态当成没有异常。

## 超时与负载

- 每项探测目标上限 2 秒，所有依赖并行检查；部分失败仍保留其他依赖的诊断结果。异常文本不直接返回，避免泄露连接信息。
- 每个 Web 进程对同一探测只保留一次未完成调用。若驱动尚未结束，后续请求共用同一个超时结果，避免健康轮询在故障期间不断累积数据库查询或 Redis 命令。
- 超时不等于驱动调用已取消。底层调用结束后探测可恢复；长期不返回时持续返回不可用，等待连接恢复或进程恢复。测试覆盖超时后的并发重试与恢复。
- 数据库、Redis、Worker 结果仅在进程内复用 1 秒；管理员、队列及周挑战诊断复用 5 秒。正常轮询不重复高频读取业务表，状态变化最多延迟相应缓存窗口被观察到。
- Compose 使用单次 `wget -T 4 -t 1`，外层 timeout 5 秒、15 秒间隔、30 秒启动宽限。部署/staging 的 curl 也有连接与总时限，保护事件循环不响应等服务端无法自行计时的情形。

这是职责拆分，尚不等同于流量无缝切换、主机全程发布锁或自动回滚；这些发布控制需在后续发布链路改动中整合。

## 验证与故障演练

`tests/health-routes.test.ts` 先复现依赖悬挂导致无响应、单点失败丢失诊断两项问题，随后验证存活无依赖、Worker 失败不影响 Web 就绪、Redis/数据库故障、版本不一致门禁、配置门禁、业务降级兼容、并发探测复用和恢复。

CI staging 在真实 App/Worker 镜像上执行 `scripts/test-staging-health.sh`：

1. 验证完整健康状态与目标 SHA。
2. 停止 Worker，断言 live/ready 为 200、完整健康为 503，恢复后校验同版健康。旧 Worker 强停后心跳可保留 45 秒，演练允许 60 次轮询等待租约和探测缓存自然失效，不直接删除 Redis 心跳来制造结果。
3. 分别停止 Redis、PostgreSQL，断言 live 为 200、ready 为 503，恢复依赖后校验完整健康。

脚本仅接受 `CI=true`、`STAGING_HEALTH_FAULT_TESTS=1`、`POSTGRES_DB=miaomiao_staging` 的显式隔离环境。任何退出都会尝试重新启动依赖；不得在正式主机执行。它不修改或删除数据库数据。生产环境只进行只读检查。

无需 migration。应用回滚时保留详细 `/api/health` 合约；旧版本没有 `/api/health/ready`，必须使用该旧版本配套的 Compose healthcheck，避免旧应用被新路径错误判为不健康。正式发布须通过整合后的 staging 和 [自动发版门禁](AUTOMATIC-RELEASE.md)，不要求逐次人工确认。

职责划分参考 [Kubernetes 探测语义](https://kubernetes.io/docs/concepts/workloads/pods/probes/)，Compose 参数参考 [Docker healthcheck 文档](https://docs.docker.com/reference/compose-file/services/#healthcheck)。本项目继续使用 Docker Compose，不引入 Kubernetes。

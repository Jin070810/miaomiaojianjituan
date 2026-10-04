# Worker 运行时依赖裁剪

## 问题与变更

原 Worker 直接复制完整 `deps/node_modules`，把 Next.js、React、中文字体、图标库、Playwright Test 和 Vitest 一并放入镜像。Worker 和迁移/运维 CLI 实际只需要 11 个直接依赖。共享 `lib/security.ts` 中一个返回限流响应的函数使后台任务间接依赖 Next.js；改为 Node 22 原生 `Response.json`，保留 429、JSON 错误内容和 Retry-After 语义。

新增 `worker-deps` Docker stage，复用完整 `npm ci` 已安装的依赖和原生二进制，生成临时 Worker package 后执行 `npm prune --omit=dev --ignore-scripts --offline --no-audit --no-fund`。不在这一步下载包或执行安装脚本。Web 构建继续使用完整 deps，最终 Worker 只复制裁剪后的目录、对应 manifest/lock 以及体积记录。

直接依赖清单在 `scripts/worker-runtime-deps.mjs`，版本全部来自根 `package-lock.json`：

- `@prisma/client`、`prisma`、`tsx`：数据库、迁移和 TypeScript CLI。
- `bullmq`、`ioredis`：队列、心跳和限流。
- `argon2`、`dotenv`、`zod`：密码、配置和验证。
- `playwright-core`、`ali-oss`、`nodemailer`：平台抓取、备份和告警。

Prisma CLI、tsx 原来属于根项目开发依赖，但在 Worker 中确实用于运行，必须提升到裁剪清单的 production dependencies。Prisma 所需 TypeScript peer 依赖仍按 npm 解析保留。Chromium、curl、原生密码库和 Prisma 引擎继续保留。

这不是另一份需要手工更新的版本锁。裁剪结束后逐个比较全部保留包的 `version`、`resolved`、`integrity` 与根锁文件；出现未锁定包、替换包、缺少迁移/执行器或根依赖越界立即失败。保留 npm 的依赖和 peer 解析机制，没有手写传递依赖删除算法。参见 [npm prune](https://docs.npmjs.com/cli/v10/commands/npm-prune/) 和 [npm lockfile](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json/) 官方说明。

## 验证

源代码边界测试从 Worker 和 Dockerfile 复制的 CLI 入口递归扫描静态 import、export、require 和字面量动态 import，发现清单外依赖即失败。它不声称能静态识别任意计算出来的动态模块名；新模块还必须经过实际镜像 smoke 和 staging。

`scripts/verify-worker-runtime.mjs` 在隔离验证容器内检查前端/测试包确实不存在、所有直接依赖可解析、关键后台模块可加载，以及以下实际能力：

- Argon2id 哈希和正反密码验证；敏感字段加解密往返。
- Nodemailer JSON transport 序列化，不发真实邮件。
- Prisma Client 初始化和关闭；另运行实际 CLI 版本检查和从空库到 schema 的 SQL 生成，不连接业务数据库。
- Chromium 启动并打开 data URL，不访问平台账号。

CI 保存依赖裁剪前后字节/文件数、最终 Worker 镜像大小及 smoke 输出；另对裁剪后的实际镜像执行生产依赖审计。随后既有 staging 使用该分支 Dockerfile 构建的 Worker，运行数据库迁移、管理员初始化、真实 Redis/数据库心跳和页面验收。合入制品复用流水线时，必须把这组检查放在最终镜像发布之前，并继续使用已通过检查的同一镜像。

本地 Windows 独立副本（没有修改工作区 node_modules）实际测量：

| 指标 | 完整依赖 | 裁剪后 |
| --- | ---: | ---: |
| 文件字节 | 933,362,272 | 410,310,205 |
| 文件数 | 34,394 | 8,821 |

减少 523,052,067 字节，约 56%。本地实际裁剪耗时约 6 秒，保留包均与原锁一致，运行时审计 0 漏洞，Chromium 与 Prisma smoke 通过。这是 Windows 依赖目录测量，**不能等同于 Linux 镜像压缩传输节省或生产发布时间改善**；Linux 镜像数据以 CI 记录为准。

## 发布与回退

无业务表、migration、权限配置或 UI 布局变化。正式 Worker 命令和当前已复制的运维脚本保持可用，Web/Worker 仍必须使用同一 release SHA。生成的 Worker manifest 仅保留镜像中支持的运行命令，不包含不存在的前端构建或 PowerShell 维护入口。

本地 Docker Hub 元数据网络问题仍可能阻止构建，因此必须由真实 CI 镜像和 staging 结果作为容器门禁。新后台依赖应添加到受审查的直接依赖清单并运行全部 smoke，不得临时在生产容器 npm install。若运行时模块缺失，使用已批准旧版本的原镜像按既有发布/回滚流程恢复，不修改数据库或在主机重建。

这次裁剪移除了 Worker 镜像内的测试依赖，根项目现有两项 Vitest 开发依赖 moderate 告警仍需单独升级处理；没有降低审计门禁。

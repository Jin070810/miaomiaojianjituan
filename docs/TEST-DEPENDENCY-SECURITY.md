# 测试依赖安全升级

关联总工作项：#105。此变更修复测试工具链中 `vitest` / `@vitest/mocker` 的 GHSA-82fw-gwwq-j7x9 告警，不改变业务规则或数据库。

## 版本与边界

- Vitest 从 3.2.7 升至精确版本 4.1.11，包含官方公告的修复。
- 显式固定 Vite 7.3.6，沿用原锁文件版本，避免同时跨入 Vite 8。
- Node.js 沿用 CI 和镜像的 22 系列。Vitest 4 要求 Node.js 20 及以上、Vite 6 及以上。
- 测试扫描范围限定为 `tests`，继续排除 Playwright 目录；保持串行文件执行和清理 mock 配置。
- `alerts` 测试以受控 `Date.now` 验证冷却窗口，消除毫秒级系统时钟边界导致的偶发失败。
- 复用其他审计 PR 的 Nodemailer 10.0.9 安全补丁。对比该补丁后的锁文件，Vitest 升级没有修改任何生产依赖的版本、下载地址或完整性摘要。

官方公告描述的是测试开发服务器相关文件访问边界；依赖扫描本身不能证明线上已发生利用。此项目使用 `vitest run`，没有为用户开放 Vitest UI 或 browser mode 服务。

## 锁文件与验证

Windows 上 npm 10.9.4 / 10.9.9 在更新旧 peer dependency 图时出现内部 `edgesOut` 错误。使用临时 `npx npm@11.13.0 install --package-lock-only --ignore-scripts --no-audit --no-fund` 在独立目录生成锁文件；没有修改全局 npm，没有使用 `--force` 或 `--legacy-peer-deps`。随后用项目现有 npm 10.9.4 执行 `npm ci`，验证锁文件可正常复现安装。

CI 保留生产依赖审计，并新增 `npm audit --audit-level=moderate`，覆盖开发和测试依赖。扫描依赖公共公告数据库，结果会随新的公告变化；不得靠删除检查或忽略所有开发依赖让告警消失。

验证需记录：普通测试、真实 PostgreSQL 集成测试、类型检查、生产构建、全量与生产依赖审计、App/Worker 镜像构建和 staging 回归。UI 没有变化，沿用完整 CI Playwright 验收。

## 回滚

没有 migration、配置或线上业务行为变更。若测试兼容性有问题，优先修正不兼容的测试写法；直接回退至 3.2.7 会重新引入已知告警，不能作为长期修复。正式发布仍需整体 PR 审查、staging 和发布记录。

## 官方依据

- [Vitest 安全公告 GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9)
- [Vitest 4.1.11 迁移指南源码](https://github.com/vitest-dev/vitest/blob/v4.1.11/docs/guide/migration.md)

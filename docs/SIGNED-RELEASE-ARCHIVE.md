# 已部署候选的签名留存与恢复

关联 #105，接在不可变镜像和主机发布控制器之后。此变更尚未合并、发布；不把历史无签名版本转换成已验收候选。

## 要解决的问题

Actions 中的候选 artifact 保留 90 天，服务器上的 JSON 副本本身不能证明内容未被替换。新链路让 main CI 在镜像验收、原镜像推送和 manifest 生成之后，通过 GitHub OIDC 为 manifest 的精确字节签名。manifest 包含镜像 registry digest、config ID、源 SHA、CI run/attempt、验收项、schema 和 migration 校验和。

仅 publish job 获得 `id-token: write`、`attestations: write`。PR 没有签名或 registry 写权限。`actions/attest` 固定为已核对的 v4 commit `1e69f48acb82d1966a394da916b4c1698aa569d6`；产物上传前，用正式验签命令验证它实际生成的 bundle。签名或验证失败，整个 CI 不形成可部署的成功候选。

## 两种来源，同一门禁

Deploy Production 新增 `candidate_source`，默认 `ci-artifact`。artifact 过期不会自动降级：维护者显式选择 `server-archive`，并填写原 `candidate_run_id` 和 `candidate_attempt`。

| 来源 | 获取方式 | 必须验证 |
| --- | --- | --- |
| ci-artifact | 当前仓库成功 main CI 的指定 run/attempt artifact | 已合并 SHA、版本 tag、签名、GitHub API CI 元数据、镜像及 migration 清单 |
| server-archive | 只读 SSH 获取已部署候选的 manifest 和 bundle | 相同验证；CI 元数据从原 attempt API 读取，后续 rerun 不替代原验收 |

验签使用官方 `gh attestation verify`，同时约束当前仓库、`refs/heads/main`、源 SHA、签名 workflow 的 SHA、精确 `.github/workflows/ci.yml` 身份、GitHub Actions OIDC issuer，并拒绝 self-hosted runner。身份校验针对签名证书；不能把 bundle 里 workflow 可自行填写的 predicate 当作来源证明。不会读取归档方提供的自定义 trusted root。

精确 workflow 身份使用 `--cert-identity`（完整仓库/workflow/ref SAN），不再叠加与之互斥的 `--signer-workflow`。main CI `37187764652` 的真实发布暴露了该参数冲突，失败发生在生产部署前。core 现在用 runner 上的真实 GitHub CLI 执行同一验签脚本，要求无签名测试 bundle 到达格式解析后被拒绝；参数冲突、认证或网络错误均不能冒充通过。模拟契约测试继续检查全部来源约束，main publish 仍必须对真实签名做正向密码学验证。

随后仍通过 GitHub 已认证 API 读取原 run/attempt，确认 main 上的 push 或 workflow_dispatch、仓库、SHA、workflow、attempt 和 completed/success；再将 schema/migration 清单与该 SHA 的 Git 源码逐一比较。有效签名不豁免 CI 或数据库兼容性检查。自动化合并显式 dispatch main CI 的原因见 [自动发版](AUTOMATIC-RELEASE.md)。

`server-archive` 解决 artifact 留存期问题，不承诺 GitHub 完全离线或所有历史记录被删除后仍能恢复。如果原 CI attempt 不可读取、签名缺失、镜像摘要被清理、来源不符或数据库不兼容，会明确失败；应选择可验证版本或重新验收前向修复，不能临时重建后沿用旧证明。

## 主机留存

成功发布后，在以下目录原子保存一对不可变文件：

```text
releases/<release-SHA>/candidates/<CI-run>-<CI-attempt>/
  release-candidate.json
  release-candidate.sigstore.json
```

相同 ID 的内容不一致时拒绝覆盖。每次部署 attempt 还保留所使用的 bundle。读取只允许完整 SHA/数字 ID、两个固定文件名、普通文件和项目下的真实路径，限制文件大小与 SSH 时间；既不切换服务器源码，也不注入配置。下载结果在验签及全部来源检查通过前不能进入发布控制器。

首次采用此链路时，旧 v1.11.0 等没有 manifest/签名的镜像仍不能走这个入口。应单独对原镜像做隔离重新验收并建立明确的可信基线，保留其旧行为和风险记录，不能伪造历史签名或用重新构建的同 SHA 镜像冒充原镜像。该首次基线仍是全量实施的后续工作。

## 测试与边界

- `test-signed-release.sh` 验证验签调用必须包含精确身份约束，官方工具拒绝时立即失败，缺少 bundle 或错误 SHA 不可继续。这里模拟工具返回，测试的是调用契约，没有伪造真实签名。
- 留存读取测试使用隔离目录和 SSH 命令适配器，验证带空格路径、完整双文件、缺失 bundle、符号链接和非法 run ID。
- 发布控制器测试确认 bundle 与 manifest 同目录保留，既有阶段故障、锁和秘密保护测试继续执行。
- 实际正向密码学验证由 main-only publish 对新生成的真实 bundle 执行；该步骤尚未通过合并后的 main run 时，不能宣称已有可部署签名候选。

依据：[GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)、[官方 attest Action 输出](https://github.com/actions/attest)、[GitHub CLI 验签身份约束](https://cli.github.com/manual/gh_attestation_verify)。

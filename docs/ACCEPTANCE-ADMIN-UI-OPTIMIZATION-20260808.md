# 管理后台界面优化验收记录（2026-08-08）

状态：`Ready for review`。已完成实现、本地自动化验证和真实浏览器复核；尚未完成 PR 自审或非作者审查、staging 验收和正式发布记录，不得标记为已上线。

## 范围与结果

- 榜单列表改用 `GET /api/admin/rankings?view=summary`，响应不含解密后的姓名、手机号和地址，仅返回 `hasRecipientDetails`。
- `GET /api/admin/rankings/awards/:id` 仅管理员可访问，按需解密领奖资料，返回 `Cache-Control: private, no-store`，并在同一事务中写入查看审计。
- 旧榜单响应暂保留一个兼容发布周期；新版后台 HTML 和 summary 列表响应中不包含完整手机号或地址。
- 订单接口增加向后兼容的 `statusCounts: { all, pending, fulfilled }`；后台首批加载 20 条，桌面和移动端均保留搜索，状态页签始终显示数字。
- 移动菜单、视频二审卡片、订单布局、趋势图溢出、模块切换回顶均已调整；高风险操作增加影响说明和变更前后确认。
- 榜单历史周期、公告全文改为按需展开；礼品增加筛选、库存排序和操作菜单；生日成员选择改为可搜索组合框；全局搜索状态已本地化并增加辨识信息。

## 自动化与浏览器验证

| 门禁 | 结果 |
| --- | --- |
| `npm run lint` | 通过 |
| `npm test` | 118 项通过，57 项数据库测试按预期跳过 |
| `$env:RUN_DB_TESTS="1"; npm test` | 隔离 schema `admin_ui_20260808`，175 项通过 |
| `npm run build` | 通过 |
| `npm audit --omit=dev` | 0 个漏洞 |
| `docker compose config` | 通过，本地未注入生产密钥的警告符合预期 |
| `docker compose build app` | 通过 |
| `docker build --target worker -t miaomiao-points-worker:verify .` | 通过 |
| Playwright `390×844` 与 `1440×900` | 管理后台 8 项通过 |

浏览器验收覆盖导航回顶、页面级溢出、移动菜单、订单搜索与计数、移动二审卡片和不小于 `44px` 的操作目标。本地截图：

- `output/playwright/admin-responsive-admin-mobile.png`
- `output/playwright/admin-responsive-admin-desktop.png`
- `output/playwright/admin-secondary-review-390x844.png`

## 风险、兼容与回滚

- 本次无 Prisma migration，未修改积分入账、订单事务或认证会话模型。
- 新接口只增加字段或新路由，旧榜单默认响应暂时保留；移除明文兼容字段前必须确认无其他消费者。
- 应用可回滚到本分支之前的 `origin/main` commit `60d0f9f`；回滚不涉及数据库。

## 待完成

- 创建 PR，由非作者审查，或由仓库所有者按 PR 模板完成单人维护者自审并记录决定。
- 部署至 staging，使用脱敏数据复验管理员 RBAC、领奖资料查看审计、确认对话框、加载/空数据/失败/禁用/成功/取消状态和两个验收视口。
- 合并后由维护者补齐发布版本、commit、操作人、备份、回滚点和监控记录。

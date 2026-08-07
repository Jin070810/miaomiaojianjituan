# 生日星愿体系验收记录

状态：`Ready for review`。代码、隔离数据库验证、生产构建和双尺寸 UI 验收已完成；正式 staging 部署、维护者自审、奖池库存确认和生产发布批准仍待完成。

## 验收版本

- 分支：`feature/birthday-system-20260807`
- 功能提交：`eabe8f7 feat: add birthday star wish system`
- 收尾提交：`e0878f5 feat: introduce birthday benefits onboarding`
- Pull Request：[#73](https://github.com/Jin070810/miaomiaojianjituan/pull/73)
- 隔离数据库：本地 PostgreSQL 的 `staging_birthday_20260807` schema，不含生产成员数据

## 本轮产品验收

- 账号首次进入生日星愿页时展示权益说明，包含年度必中奖、生日作品 20% 加成及年度 500 分上限、祝福与自愿积分心意、寿星标识、勋章和年度纪念。
- 点击“我知道了”或关闭弹窗后，服务端记录首次查看时间；刷新及同账号再次访问不重复展示，重复确认不覆盖首次时间。
- 成员端页面和 API 不返回抽奖概率、策略版本或期望值；服务端仍固化 `birthday-draw-v1`，管理员端保留结果分布和审计能力。
- 首页不返回其他寿星名单，也不因其他成员生日生成通知；只有主动进入生日墙后才查询今日寿星和未来 30 天生日。
- 领奖并发只创建一个零积分订单；抽奖、领奖和生日资料响应不包含内部幂等键或生日密文。
- 已固化的年度抽奖窗口不会因生日日期修改而重新开放；管理员延长窗口后，服务端按持久化的关闭时间放行。

## 自动化与构建结果

```text
npm run lint                                                PASS
$env:RUN_DB_TESTS="1"; npm test                            PASS (38 files / 167 tests)
npm run build                                               PASS
npm audit --omit=dev --audit-level=high                     PASS (0 vulnerabilities)
docker compose config                                       PASS
docker compose build app                                    PASS
docker build --target worker -t miaomiao-points-worker:verify .  PASS
npx prisma migrate status                                   PASS (34 migrations, schema up to date)
npm run data:reconcile                                      PASS (0 anomalies)
Playwright birthday projects                                PASS (4/4)
```

数据库集成测试包含五个并发商品领奖请求、生日改期后旧窗口关闭和管理员延长抽奖窗口，断言只生成一个生日兑换订单且年度权益不被重置。全部四个生日 migration 均通过新增 migration 应用，未修改历史 migration。

## UI 验收

- 视口：`390x844`、`1440x900`。
- 路径：首页固定入口 -> 生日星愿 -> 首次权益说明 -> 确认 -> 今日寿星 -> 刷新后不重复展示。
- 验证概率文案、`birthday-draw-v1` 和商品概率档位不出现在成员页面。
- 验证弹窗、生日墙和完整页面无横向溢出、遮挡或裁切。
- 截图位于本地忽略目录 `output/playwright/`，包括两种视口的权益说明和生日墙状态。
- Browser 插件重启开发服务后被本地地址导航策略阻断，按前端测试规范回退到仓库 Playwright；Playwright 测试和截图均通过。

## 发布门禁

- 维护者需完成 PR 自审或邀请非作者审查，重点确认积分事务、并发幂等、敏感数据、RBAC、四个 migration 和回滚点。
- 在正式 staging 使用脱敏测试账号复验生日登记、7 天生效、隐藏、祝福、抽奖、商品领奖、作品加成、撤销和 Worker 提醒。
- 上线前配置生日商品奖池并核对预留库存，确认管理员账号、生产密钥、HTTPS、数据库备份、Redis、Worker 和监控告警。
- 合并并创建 release commit 后，先执行 migration，再部署相同版本的 Web 和 Worker；先开启 `BIRTHDAY_PROGRAM`，验收后再开启 `BIRTHDAY_REWARDS`。

## 回滚

先关闭 `BIRTHDAY_REWARDS`，再关闭 `BIRTHDAY_PROGRAM`。保留已产生的积分、订单、奖品和审计记录；四个追加 migration 不做逆向删除，结构问题使用前向 migration 修复，错账通过审计补偿处理。

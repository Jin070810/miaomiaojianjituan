# 专属链接入团申请验收记录

状态：`Ready for review`。已完成受控链接、入团申请、审核事务、登录页切换和自动化测试；尚未完成 PR 审查、staging 验收和正式发布记录，不得标记为已上线。

## 已实现

- 登录页移除公开注册入口，旧 `/api/auth/register` 返回 410 且不创建账号。
- 管理员可以生成、轮换和停用单个入团链接；数据库只保存 token 哈希。
- 申请资料和密码哈希先存入 `RegistrationApplication`，申请期间不创建 `User`、Session 或积分账户。
- 审核员和管理员可以批准或驳回申请；驳回必须填写原因。
- 批准在事务中创建成员、0 分账户、公会状态历史、成员资格和审计记录。
- 同一快手 ID 待审核申请唯一，审批锁定并具备幂等保护。
- 申请人凭申请编号和查询凭证查看待审核、通过或驳回原因。

## 验收命令

```powershell
npx prisma validate
npx prisma generate
npm test -- --run tests/registration.test.ts tests/registration-routes.test.ts
npm run lint
npm run build
```

完整 PR 前仍需执行仓库规定的数据库集成测试、Playwright 双尺寸验收、`npm audit`、Docker 配置和镜像构建检查。

## 发布注意

先限制旧注册写入口，再执行新增 migration，随后部署 Web/Worker 同版本。生产发布前必须在 staging 验证申请提交、凭证查询、审核批准/驳回、重复审批和并发唯一性，并记录回滚点。

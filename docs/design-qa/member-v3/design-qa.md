# 妙妙剪辑团成员端 V3 设计 QA

## 验证结论

第二轮视觉比对后未发现仍需阻止交付的 P0、P1 或 P2 问题。成员端已从旧版的大色块卡片布局重构为“奶油纸张 × 直播高光手帐”视觉系统，并在保留现有 API、权限、积分事务和数据库结构的前提下完成主要功能路径。

任务系统没有照搬概念图中的虚构内容。页面直接使用当前项目的 `WeeklyChallengeAssignment`、`WeeklyChallengePeriod` 和 `/api/weekly-challenges/current` 返回数据，支持：

- `VIDEO_COUNT`、`LIKE_SUM`、`COMBINED` 三种任务类型。
- `ACTIVE`、`COMPLETED`、`CLAIMED`、`REVERSED`、`EXPIRED` 五种成员状态。
- 任务标题、说明、生成理由、起点、目标、实时进度、普通奖励、竞速奖励、任务周期和领取截止时间。
- 奖励开关、是否达标、是否可领取、竞速是否结束和领取失败提示。
- 没有本周任务、继续提交切片、等待开放领取、领取奖励、奖励到账、任务结束等实际状态。

## 视觉真值

原型图位于：

- `docs/design-prototypes/member-brand-v3/01-login.png`
- `docs/design-prototypes/member-brand-v3/02-home.png`
- `docs/design-prototypes/member-brand-v3/03-videos.png`
- `docs/design-prototypes/member-brand-v3/04-gifts.png`
- `docs/design-prototypes/member-brand-v3/05-ranking.png`
- `docs/design-prototypes/member-brand-v3/06-profile.png`
- `docs/design-prototypes/member-brand-v3/07-points-ledger.png`
- `docs/design-prototypes/member-brand-v3/08-transfer-history.png`
- `docs/design-prototypes/member-brand-v3/09-redemption-history.png`
- `docs/design-prototypes/member-brand-v3/10-weekly-task-layout-reference.png`

任务原型只作为版式和美术参考，最终信息结构以仓库中的真实任务模型为准。

## 响应式验证

- 移动端 CSS 视口：`390 × 844`
- 桌面端 CSS 视口：`1440 × 900`
- 登录、注册、首页、我的切片、积分礼物屋、榜单、我的、本周任务、积分记录、送积分记录和兑换记录均已检查。
- 移动端保留底部导航；任务和记录页使用清晰返回路径。
- 桌面端保留左侧导航与主内容区，不再出现记录页空白侧栏。
- 页面根节点无横向溢出，长昵称、长快手 ID、长错误信息和大积分数字使用换行或省略策略。
- 表单标签、可见焦点、最小触控尺寸、图片替代文本和状态文案已纳入检查。

最终截图位于 `docs/design-qa/member-v3/`，主要包括：

- `login-mobile-final.png`
- `register-mobile-final.png`
- `login-desktop-final.png`
- `home-mobile-final.png`
- `videos-mobile-final.png`
- `gifts-mobile-final.png`
- `rank-mobile-final.png`
- `profile-mobile-final.png`
- `ledger-mobile-final.png`
- `transfers-mobile-final.png`
- `orders-mobile-final.png`
- `task-mobile-final.png`
- `task-desktop-final.png`

## 逐屏组合比对

原型与实现截图已按相同可见宽度组合后检查，证据位于 `docs/design-qa/member-v3/comparisons/`：

- `login-source-vs-implementation.jpg`
- `home-source-vs-implementation.jpg`
- `videos-source-vs-implementation.jpg`
- `gifts-source-vs-implementation.jpg`
- `ranking-source-vs-implementation.jpg`
- `profile-source-vs-implementation.jpg`
- `ledger-source-vs-implementation.jpg`
- `transfers-source-vs-implementation.jpg`
- `orders-source-vs-implementation.jpg`
- `task-source-vs-implementation.jpg`

重点比对区域包括登录输入框和首屏按钮、首页任务入口、任务进度与奖励信息、四项筛选栏、大额礼物价格、榜单长昵称和记录页桌面导航。

## 修复记录

第一轮发现并修复：

- P1：移动端登录主按钮落在首屏以下。压缩登录主视觉高度和段落间距。
- P1：注册密码输入框的图标与文字重叠。移除旧全局绝对定位对新输入框的影响。
- P2：我的切片第四个筛选项被裁切。改为四列等宽网格。
- P2：商城大额积分价格溢出。增加响应式字号、换行和最小宽度约束。
- P2：榜单两位数名次占位过宽。仅前三名保留强调字号，其余统一为紧凑字号。
- P2：桌面端任务和记录页出现空白侧栏。统一桌面成员壳层，只在移动端隐藏主导航。
- P2：任务页人物插图压住标题和说明。重新限制文案安全区和人物定位。

第二轮组合比对后没有保留的 P0、P1 或 P2。以下差异为有意保留：

- 首页任务区显示真实任务内容，不使用原型里的固定示例数字。
- 商城展示实际接口返回的礼品图片，不以概念商品替换真实数据。
- 任务详情为了容纳动态任务理由、双指标、奖励开关和截止时间，比概念图更长，保持移动端可读字号和触控空间。
- 个人中心优先展示真实可操作入口，因此比概念图多一个“常用操作”分组。

## 功能路径

已在本地成员账号状态下检查：

- 首页任务入口进入本周任务。
- 任务主按钮进入我的切片。
- 修改资料打开真实资料表单。
- 送积分给团友打开真实转账表单。
- 收货与收款信息打开真实资料表单。
- 账号安全打开真实密码修改表单。
- 积分记录、送积分记录、兑换记录进入对应真实记录页并可返回。
- 首页、切片、礼物、榜单、我的五个主导航可切换。

本地设计验收使用了一条隔离的 `COMBINED` 任务夹具，以同时检查视频数和点赞数两个真实指标。该夹具只存在于本地验收数据库，不属于代码、Git 资产或生产数据。


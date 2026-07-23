# 通知与公告 Migration

## 范围

`20260724010000_notifications_announcements` 新增 `Announcement`、`AnnouncementRecipient`、`Notification`，以及通知类型、公告状态和受众枚举；同时为用户增加创建者、公告收件人和通知关系。

## 部署

```powershell
npm run db:deploy
```

部署前备份数据库并在 staging 使用脱敏数据验证全员/定向发布、撤回和已读状态。该 migration 只新增表和索引，不修改既有列。

## 回滚

不回退已执行 migration。应用回滚到不包含通知功能的版本时，新增表保留，不影响既有积分、订单和视频数据；重新上线包含通知功能的版本后可继续读取历史记录。若必须删除表，只能在确认无通知历史留存要求后制定新的前向 migration，并经过业务和技术负责人审批。

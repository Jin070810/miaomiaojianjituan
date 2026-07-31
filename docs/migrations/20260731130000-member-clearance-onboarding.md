# 20260731130000 Member Clearance Onboarding

为 `MemberEligibility` 增加 `onboardingSeenAt`，用于按成员账号记录首次规则说明确认时间。该 migration 不回退；如需重新告知，使用受审计的前向数据修复将指定测试账号字段清空。

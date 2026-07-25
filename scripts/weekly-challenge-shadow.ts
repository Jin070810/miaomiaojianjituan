import "dotenv/config";
import crypto from "node:crypto";
import { db } from "../lib/db";
import { sendOperationalAlert } from "../lib/alerts";
import {
  generationFailureCategory,
  summarizeGenerationAttempts,
} from "../lib/weekly-challenge-diagnostics";
import { generateWeeklyChallengePeriod } from "../lib/weekly-challenge-generation";
import { nextShanghaiWeekBounds } from "../lib/weekly-challenges";

const DAY_MS = 24 * 60 * 60 * 1000;
const MEMBER_COUNT = 300;
const CONFIRMATION = "I_UNDERSTAND_PAID_DEEPSEEK_SHADOW";
let reportSchema: string | null = null;

function assertShadowEnvironment() {
  if (process.env.WEEKLY_CHALLENGE_SHADOW_CONFIRM !== CONFIRMATION) {
    throw new Error(`必须设置 WEEKLY_CHALLENGE_SHADOW_CONFIRM=${CONFIRMATION}`);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL");
  const schema = new URL(databaseUrl).searchParams.get("schema") ?? "";
  if (!/^(shadow|staging)[-_][a-z0-9_-]+$/i.test(schema)) {
    throw new Error("影子运行只允许使用名称以 shadow_、shadow-、staging_ 或 staging- 开头的独立 schema");
  }
  reportSchema = schema;
  for (const key of ["DEEPSEEK_BASE_URL", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL"] as const) {
    if (!process.env[key]?.trim()) throw new Error(`缺少 ${key}`);
  }
  const webhook = process.env.ALERT_WEBHOOK_URL?.trim() ?? "";
  if (webhook && !webhook.startsWith("https://")) {
    throw new Error("ALERT_WEBHOOK_URL 必须是 HTTPS 地址");
  }
  const webhookConfigured = Boolean(webhook);
  const emailKeys = ["ALERT_EMAIL_TO", "ALERT_SMTP_HOST", "ALERT_SMTP_USER", "ALERT_SMTP_PASSWORD"] as const;
  const configuredEmailKeys = emailKeys.filter((key) => process.env[key]?.trim());
  if (configuredEmailKeys.length && configuredEmailKeys.length !== emailKeys.length) {
    throw new Error("SMTP 邮件告警配置不完整");
  }
  if (configuredEmailKeys.length === emailKeys.length) {
    const smtpPort = Number(process.env.ALERT_SMTP_PORT?.trim() || "465");
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65_535) {
      throw new Error("ALERT_SMTP_PORT 必须是 1 到 65535 之间的整数");
    }
    const smtpSecure = process.env.ALERT_SMTP_SECURE?.trim().toLowerCase();
    if (smtpSecure && smtpSecure !== "true" && smtpSecure !== "false") {
      throw new Error("ALERT_SMTP_SECURE 必须是 true 或 false");
    }
  }
  if (!webhookConfigured && configuredEmailKeys.length !== emailKeys.length) {
    throw new Error("缺少 ALERT_WEBHOOK_URL 或完整 SMTP 邮件告警配置");
  }
  return schema;
}

function shadowPeriodStarts() {
  const first = nextShanghaiWeekBounds(new Date(Date.now() + 7 * DAY_MS)).start;
  return [first, new Date(first.getTime() + 7 * DAY_MS)];
}

async function assertCleanSchema() {
  const [users, periods, ledgers] = await Promise.all([
    db.user.count(),
    db.weeklyChallengePeriod.count(),
    db.pointLedger.count(),
  ]);
  if (users || periods || ledgers) {
    throw new Error("影子 schema 必须为空；请新建独立 schema 并先执行 prisma migrate deploy");
  }
}

async function seedSyntheticHistory(firstPeriodStart: Date, runId: string) {
  await db.systemSetting.create({
    data: {
      key: "WEEKLY_CHALLENGES",
      enabled: false,
      description: "真实 DeepSeek 影子运行期间保持关闭",
    },
  });
  await db.user.createMany({
    data: Array.from({ length: MEMBER_COUNT }, (_, index) => ({
      kuaishouId: `shadow-${runId}-${index.toString().padStart(3, "0")}`,
      nickname: `匿名影子成员 ${index + 1}`,
      passwordHash: "shadow-only-not-for-login",
      role: "MEMBER" as const,
      active: true,
      createdAt: new Date(firstPeriodStart.getTime() - (index < 60 ? 10 : 90) * DAY_MS),
    })),
  });
  const users = await db.user.findMany({
    where: { kuaishouId: { startsWith: `shadow-${runId}-` } },
    orderBy: { kuaishouId: "asc" },
    select: { id: true, nickname: true },
  });
  if (users.length !== MEMBER_COUNT) throw new Error(`影子成员创建不完整：${users.length}/${MEMBER_COUNT}`);

  const videos = users.flatMap((user, memberIndex) =>
    Array.from({ length: 5 }, (_, weekIndex) => {
      const weekStart = new Date(firstPeriodStart.getTime() + (weekIndex - 4) * 7 * DAY_MS);
      const count = memberIndex < 60
        ? 1 + ((memberIndex + weekIndex) % 2)
        : 1 + ((memberIndex * 3 + weekIndex) % 5);
      return Array.from({ length: count }, (_, videoIndex) => {
        const unique = `${runId}-${memberIndex}-${weekIndex}-${videoIndex}`;
        return {
          userId: user.id,
          sourceUrl: `https://shadow.invalid/${unique}`,
          requestUrl: `https://shadow.invalid/${unique}`,
          sourceKind: "shadow-synthetic",
          photoId: `shadow-photo-${unique}`,
          status: "APPROVED" as const,
          likes: 220 + ((memberIndex * 97 + weekIndex * 211 + videoIndex * 53) % 4_800),
          points: 0,
          submittedNickname: user.nickname,
          submittedAt: new Date(weekStart.getTime() + (videoIndex + 1) * DAY_MS),
          reviewedAt: new Date(weekStart.getTime() + (videoIndex + 1) * DAY_MS + 60_000),
          idempotencyKey: `shadow-video-${unique}`,
        };
      });
    }).flat(),
  );
  for (let index = 0; index < videos.length; index += 500) {
    await db.videoSubmission.createMany({ data: videos.slice(index, index + 500) });
  }
  return users;
}

async function periodReport(periodId: string) {
  const period = await db.weeklyChallengePeriod.findUniqueOrThrow({
    where: { id: periodId },
    include: {
      assignments: { select: { type: true, rewardPoints: true } },
      attempts: {
        select: {
          batchNumber: true,
          status: true,
          latencyMs: true,
          inputTokens: true,
          outputTokens: true,
          error: true,
        },
      },
    },
  });
  const totalRewards = period.assignments.reduce((sum, row) => sum + row.rewardPoints, 0);
  const rewards = period.assignments.map((row) => row.rewardPoints);
  const distribution = period.assignments.reduce<Record<string, number>>((result, row) => {
    result[row.type] = (result[row.type] ?? 0) + 1;
    return result;
  }, {});
  const attemptSummary = summarizeGenerationAttempts(period.attempts);
  if (period.status !== "READY") throw new Error(`影子周期未就绪：${period.status}`);
  if (period.assignments.length !== MEMBER_COUNT) {
    throw new Error(`影子周期覆盖不完整：${period.assignments.length}/${MEMBER_COUNT}`);
  }
  if (totalRewards > period.personalRewardBudget) throw new Error("影子周期个人奖励超出预算");
  if (rewards.some((reward) => !Number.isInteger(reward) || reward < 10 || reward > 1500)) {
    throw new Error("影子周期存在非法个人奖励");
  }
  return {
    periodStart: period.periodStart.toISOString(),
    status: period.status,
    audienceCount: period.audienceCount,
    assignmentCount: period.assignments.length,
    distribution,
    rewardBudget: period.personalRewardBudget,
    totalRewards,
    minimumReward: Math.min(...rewards),
    maximumReward: Math.max(...rewards),
    ...attemptSummary,
    tokens: attemptSummary.totalTokens,
    model: period.model,
    promptVersion: period.promptVersion,
  };
}

async function failureReport(error: unknown) {
  const periods = await db.weeklyChallengePeriod.findMany({
    orderBy: { periodStart: "asc" },
    include: {
      assignments: { select: { rewardPoints: true } },
      attempts: {
        select: {
          batchNumber: true,
          status: true,
          latencyMs: true,
          inputTokens: true,
          outputTokens: true,
          error: true,
        },
      },
    },
  });
  const switchState = await db.systemSetting.findUnique({ where: { key: "WEEKLY_CHALLENGES" } });
  return {
    success: false,
    schema: reportSchema,
    syntheticMembers: MEMBER_COUNT,
    errorCategory: generationFailureCategory(error),
    challengePeriods: periods.map((period) => ({
      periodStart: period.periodStart.toISOString(),
      status: period.status,
      audienceCount: period.audienceCount,
      assignmentCount: period.assignments.length,
      totalRewards: period.assignments.reduce((sum, assignment) => sum + assignment.rewardPoints, 0),
      rewardBudget: period.personalRewardBudget,
      model: period.model,
      promptVersion: period.promptVersion,
      ...summarizeGenerationAttempts(period.attempts),
    })),
    rewardsEnabled: switchState?.enabled ?? null,
    reviewedAt: new Date().toISOString(),
  };
}

async function main() {
  const schema = assertShadowEnvironment();
  reportSchema = schema;
  await assertCleanSchema();
  const runId = crypto.randomBytes(5).toString("hex");
  const [firstStart, secondStart] = shadowPeriodStarts();
  const users = await seedSyntheticHistory(firstStart, runId);
  const first = await generateWeeklyChallengePeriod({ periodStart: firstStart });
  await db.weeklyChallengeAssignment.updateMany({
    where: {
      periodId: first.id,
      userId: { in: users.filter((_, index) => index % 5 < 3).map((user) => user.id) },
    },
    data: {
      status: "COMPLETED",
      completedAt: new Date(firstStart.getTime() + 6 * DAY_MS),
    },
  });
  const second = await generateWeeklyChallengePeriod({ periodStart: secondStart });
  const reports = await Promise.all([periodReport(first.id), periodReport(second.id)]);
  const switchState = await db.systemSetting.findUniqueOrThrow({ where: { key: "WEEKLY_CHALLENGES" } });
  if (switchState.enabled) throw new Error("影子运行期间周挑战开关不得开启");
  const result = {
    success: true,
    schema,
    syntheticMembers: MEMBER_COUNT,
    historicalWeeks: 5,
    challengePeriods: reports,
    rewardsEnabled: switchState.enabled,
    reviewedAt: new Date().toISOString(),
  };
  const alert = await sendOperationalAlert({
    source: "weekly-challenge-shadow",
    severity: "info",
    message: "v1.3 真实 DeepSeek 双周期影子运行通过",
    details: {
      schema,
      syntheticMembers: MEMBER_COUNT,
      periods: reports.length,
      models: [...new Set(reports.map((report) => report.model))],
    },
  });
  if (!alert.sent) throw new Error(`影子运行结果告警发送失败：${alert.reason}`);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch(async (error) => {
    try {
      console.log(JSON.stringify(await failureReport(error), null, 2));
    } catch {
      console.log(JSON.stringify({
        success: false,
        schema: reportSchema,
        errorCategory: generationFailureCategory(error),
        reportUnavailable: true,
        reviewedAt: new Date().toISOString(),
      }, null, 2));
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

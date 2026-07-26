import crypto from "node:crypto";
import { Prisma, WeeklyChallengeType } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { sendOperationalAlert } from "./alerts";
import { generationFailureCategory } from "./weekly-challenge-diagnostics";
import {
  activateAndCloseWeeklyChallenges,
  nextShanghaiWeekBounds,
  opaqueMemberRef,
} from "./weekly-challenges";
import {
  buildRewardTiers,
  difficultyForTargets,
  MAX_PERSONAL_REWARD,
  REWARD_POLICY_VERSION,
  RewardTier,
  targetBounds,
} from "./weekly-challenge-rewards";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const BATCH_SIZE = 25;
const RACE_REWARD = 2_000;
const PROMPT_VERSION = "weekly-challenge-v4-hard-combined-two-week";

type MemberProfile = {
  userId: string;
  memberRef: string;
  tenureDays: number;
  weeklyVideoCounts: number[];
  weeklyLikeSums: number[];
  referenceWeeks: Array<{
    relativeWeek: "two-weeks-ago" | "previous-week";
    videoCount: number;
    likesTotal: number;
    likesAverage: number;
    likesMax: number;
    likesMin: number;
  }>;
  baselineVideoCount: number;
  baselineLikes: number;
  bestVideoCount: number;
  bestLikes: number;
  previousChallengeCompletionRate: number;
  newMember: boolean;
};

const modelTaskSchema = z.object({
  memberRef: z.string().length(20),
  type: z.literal("COMBINED"),
  baselineVideoCount: z.number().int().nonnegative(),
  baselineLikes: z.number().int().nonnegative(),
  title: z.string().trim().min(2).max(40),
  description: z.string().trim().min(5).max(240),
  reason: z.string().trim().min(5).max(240),
  targetVideoCount: z.number().int().positive(),
  targetLikes: z.number().int().positive(),
  rewardPoints: z.number().int().min(100).max(1000),
});

const taskSchema = modelTaskSchema;

const responseSchema = z.object({
  tasks: z.array(taskSchema).min(1).max(BATCH_SIZE),
});

type GeneratedTask = z.infer<typeof taskSchema> & {
  userId: string;
  difficultyScore: number;
  rewardTiers: RewardTier[];
};

type DeepSeekUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

type DeepSeekCompletion = {
  content: string;
  usage?: DeepSeekUsage;
  streamEvents: number;
};

async function buildProfiles(periodStart: Date, userIds: string[]) {
  const referenceStart = new Date(periodStart.getTime() - 14 * DAY_MS);
  const [users, videos, historicalTasks] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIds }, active: true, role: "MEMBER" },
      select: { id: true, createdAt: true },
    }),
    db.videoSubmission.findMany({
      where: {
        userId: { in: userIds },
        status: "APPROVED",
        submittedAt: { gte: referenceStart, lt: periodStart },
      },
      select: { userId: true, submittedAt: true, likes: true },
    }),
    db.weeklyChallengeAssignment.groupBy({
      by: ["userId", "status"],
      where: { userId: { in: userIds }, period: { periodStart: { lt: periodStart } } },
      _count: { id: true },
    }),
  ]);
  const history = new Map<string, { completed: number; total: number }>();
  for (const row of historicalTasks) {
    const current = history.get(row.userId) ?? { completed: 0, total: 0 };
    current.total += row._count.id;
    if (["COMPLETED", "CLAIMED"].includes(row.status)) current.completed += row._count.id;
    history.set(row.userId, current);
  }
  const raw = users.map((user) => {
    const referenceWeeks = [0, 1].map((weekIndex) => {
      const weekStart = new Date(referenceStart.getTime() + weekIndex * 7 * DAY_MS);
      const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);
      const weekVideos = videos.filter((video) =>
        video.userId === user.id
        && video.submittedAt >= weekStart
        && video.submittedAt < weekEnd);
      const likes = weekVideos.map((video) => video.likes ?? 0);
      const likesTotal = likes.reduce((sum, value) => sum + value, 0);
      return {
        relativeWeek: weekIndex === 0 ? "two-weeks-ago" as const : "previous-week" as const,
        videoCount: weekVideos.length,
        likesTotal,
        likesAverage: weekVideos.length ? Math.floor(likesTotal / weekVideos.length) : 0,
        likesMax: likes.length ? Math.max(...likes) : 0,
        likesMin: likes.length ? Math.min(...likes) : 0,
      };
    });
    const record = history.get(user.id) ?? { completed: 0, total: 0 };
    const tenureDays = Math.max(0, Math.floor((periodStart.getTime() - user.createdAt.getTime()) / DAY_MS));
    return {
      userId: user.id,
      memberRef: opaqueMemberRef(periodStart, user.id),
      tenureDays,
      weeklyVideoCounts: [0, 0, referenceWeeks[0].videoCount, referenceWeeks[1].videoCount],
      weeklyLikeSums: [0, 0, referenceWeeks[0].likesTotal, referenceWeeks[1].likesTotal],
      referenceWeeks,
      baselineVideoCount: 0,
      baselineLikes: 0,
      bestVideoCount: Math.max(...referenceWeeks.map((week) => week.videoCount)),
      bestLikes: Math.max(...referenceWeeks.map((week) => week.likesTotal)),
      previousChallengeCompletionRate: record.total ? Math.floor(record.completed * 100 / record.total) : 0,
      newMember: tenureDays < 14,
    };
  });
  return raw;
}

function validateGeneratedTask(task: z.infer<typeof taskSchema>, profile: MemberProfile): GeneratedTask {
  if (task.type !== "COMBINED") {
    throw new Error(`成员 ${profile.memberRef} 必须同时包含视频和点赞目标`);
  }
  if (task.baselineVideoCount > profile.bestVideoCount) {
    throw new Error(`成员 ${profile.memberRef} 的视频基线判断超过历史峰值`);
  }
  if (task.baselineLikes > profile.bestLikes) {
    throw new Error(`成员 ${profile.memberRef} 的点赞基线判断超过历史峰值`);
  }
  const judgedProfile = {
    ...profile,
    baselineVideoCount: task.baselineVideoCount,
    baselineLikes: task.baselineLikes,
  };
  const rewardTiers = buildRewardTiers(judgedProfile, task);
  const finalTier = rewardTiers[rewardTiers.length - 1];
  if (finalTier.targetVideoCount === null || finalTier.targetLikes === null) {
    throw new Error(`成员 ${profile.memberRef} 的综合任务必须同时有视频和点赞目标`);
  }
  return {
    ...task,
    targetVideoCount: finalTier.targetVideoCount,
    targetLikes: finalTier.targetLikes,
    rewardPoints: finalTier.rewardPoints,
    userId: profile.userId,
    difficultyScore: difficultyForTargets(judgedProfile, finalTier.targetVideoCount, finalTier.targetLikes, task.type),
    rewardTiers,
  };
}

function buildPrompt(profiles: MemberProfile[], previousValidationError?: string) {
  const members = profiles.map((profile) => ({
    memberRef: profile.memberRef,
    referenceWeeks: profile.referenceWeeks,
  }));
  return JSON.stringify({
    objective: "为每位剪辑团成员生成一个困难但值得尝试的综合周任务。每位成员必须且只能出现一次。",
    policies: {
      coverage: `必须返回 ${profiles.length} 条任务，每个输入 memberRef 必须且只能出现一次`,
      typeSelection: "每名成员的 type 必须为 COMBINED，必须同时完成视频发布数量和累计点赞目标",
      targetRules: {
        COMBINED: "必须同时给出正整数 targetVideoCount 和 targetLikes；目标应明显高于模型判断的基线，不能选择只完成单项的任务；服务端会按困难度规则抬高或限幅最终三阶段目标",
      },
      baselineRules: "baselineVideoCount 和 baselineLikes 必须根据输入的最近两周逐周数据自行判断，不能机械取中位数；只能返回非负整数且不得超过对应两周历史峰值",
      integerOnly: true,
      rewardRange: [100, 1000],
      rewardPolicy: "服务端会根据最终难度生成 3 个累计阶梯奖励：够一够、努努力、很难但可试。第一阶段 100 分，最终累计奖励 300-1000 分；模型返回的 rewardPoints 仅作兼容字段，不决定实际发放",
      preferHighChallengeLowReward: true,
      privacy: "不得推断或输出成员身份，不得在文案中比较或点名其他成员",
      copyLength: {
        title: "6-12 个中文字符",
        description: "18-40 个中文字符，只写本周行动要求",
        reason: "18-40 个中文字符，只说明匿名基线依据",
      },
      output: "只返回 JSON：{tasks:[{memberRef,type:\"COMBINED\",baselineVideoCount,baselineLikes,title,description,reason,targetVideoCount,targetLikes,rewardPoints}]}",
    },
    ...(previousValidationError
      ? {
          retryCorrection: {
            previousValidationError,
            instruction: "修正上一版输出，重新返回本批全部成员并严格遵守 COMBINED 类型、基线与字段约束",
          },
        }
      : {}),
    members,
  });
}

function deepSeekConfig() {
  const baseUrl = process.env.DEEPSEEK_BASE_URL?.trim().replace(/\/$/, "");
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const model = process.env.DEEPSEEK_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) throw new Error("DeepSeek 周挑战配置不完整");
  return { baseUrl, apiKey, model };
}

function generationDeadline(periodStart: Date) {
  return new Date(periodStart.getTime() - HOUR_MS);
}

function assertBeforeGenerationDeadline(deadline: Date) {
  if (Date.now() >= deadline.getTime()) throw new Error("已超过周日 23:00 生成截止时间");
}

function positiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseModelOutput(content: string) {
  return responseSchema.parse(JSON.parse(content));
}

async function readDeepSeekCompletion(response: Response): Promise<DeepSeekCompletion> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: DeepSeekUsage;
    };
    return {
      content: payload.choices?.[0]?.message?.content ?? "",
      usage: payload.usage,
      streamEvents: 0,
    };
  }
  if (!response.body) throw new Error("DeepSeek 流式响应缺少正文");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const eventData: string[] = [];
  let buffer = "";
  let content = "";
  let usage: DeepSeekUsage | undefined;
  let streamEvents = 0;

  const consumeEvent = () => {
    const data = eventData.join("\n").trim();
    eventData.length = 0;
    if (!data || data === "[DONE]") return;
    let payload: {
      choices?: Array<{
        delta?: { content?: string };
        message?: { content?: string };
      }>;
      usage?: DeepSeekUsage;
    };
    try {
      payload = JSON.parse(data);
    } catch {
      throw new Error("DeepSeek 流式响应包含非法 JSON");
    }
    streamEvents += 1;
    content += payload.choices
      ?.map((choice) => choice.delta?.content ?? choice.message?.content ?? "")
      .join("") ?? "";
    if (payload.usage) usage = payload.usage;
  };

  const consumeLine = (line: string) => {
    const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (!normalized) {
      consumeEvent();
      return;
    }
    if (normalized.startsWith("data:")) eventData.push(normalized.slice(5).trimStart());
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      consumeLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  if (buffer) consumeLine(buffer);
  if (eventData.length) consumeEvent();
  return { content, usage, streamEvents };
}

function deepSeekTimeoutMs() {
  return positiveIntegerEnv("DEEPSEEK_TIMEOUT_MS", 75_000);
}

function logBatchProgress(details: Record<string, string | number>) {
  console.warn(`[weekly-challenge-progress] ${JSON.stringify(details)}`);
}

function retryCorrection(error: unknown) {
  const category = generationFailureCategory(error);
  if (!["parse", "schema_validation", "coverage", "business_validation"].includes(category)) return undefined;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.replace(/\s+/g, " ").trim().slice(0, 500) || undefined;
}

async function refreshGenerationLease(periodId: string, generationRunId: string) {
  const heartbeatAt = new Date();
  const refreshed = await db.weeklyChallengePeriod.updateMany({
    where: { id: periodId, status: "GENERATING", generationRunId },
    data: { generationStartedAt: heartbeatAt },
  });
  if (refreshed.count !== 1) throw new Error("周挑战生成租约已失效");
  return heartbeatAt;
}

async function requestBatch(
  periodId: string,
  generationRunId: string,
  batchNumber: number,
  profiles: MemberProfile[],
  deadline: Date,
) {
  const config = deepSeekConfig();
  let lastError: unknown;
  let previousValidationError: string | undefined;
  const previousAttempts = await db.weeklyChallengeGenerationAttempt.count({ where: { periodId, batchNumber } });
  for (let offset = 1; offset <= 3; offset += 1) {
    assertBeforeGenerationDeadline(deadline);
    await refreshGenerationLease(periodId, generationRunId);
    const prompt = buildPrompt(profiles, previousValidationError);
    const promptHash = crypto.createHash("sha256").update(prompt).digest("hex");
    const attemptNumber = previousAttempts + offset;
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const attempt = await db.weeklyChallengeGenerationAttempt.create({
      data: {
        periodId,
        batchNumber,
        attemptNumber,
        status: "RUNNING",
        model: config.model,
        promptVersion: PROMPT_VERSION,
        promptHash,
        requestId,
        memberCount: profiles.length,
      },
    });
    logBatchProgress({ batchNumber, attemptNumber, status: "started", memberCount: profiles.length });
    try {
      const controller = new AbortController();
      const remainingMs = deadline.getTime() - Date.now();
      if (remainingMs <= 0) throw new Error("已超过周日 23:00 生成截止时间");
      const timer = setTimeout(
        () => controller.abort(),
        Math.min(deepSeekTimeoutMs(), remainingMs),
      );
      let completion: DeepSeekCompletion;
      try {
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
            "x-request-id": requestId,
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0.4,
            response_format: { type: "json_object" },
            stream: true,
            messages: [
              {
                role: "system",
                content: "你是积分活动任务规划器。严格遵守输入中的边界，文案必须简洁，只输出合法 JSON，不输出 Markdown。",
              },
              { role: "user", content: prompt },
            ],
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
        completion = await readDeepSeekCompletion(response);
      } finally {
        clearTimeout(timer);
      }
      assertBeforeGenerationDeadline(deadline);
      const content = completion.content;
      if (!content) throw new Error("DeepSeek 未返回任务内容");
      const parsed = parseModelOutput(content);
      const expectedRefs = new Set(profiles.map((profile) => profile.memberRef));
      const returnedRefs = new Set(parsed.tasks.map((task) => task.memberRef));
      if (returnedRefs.size !== parsed.tasks.length || returnedRefs.size !== expectedRefs.size) {
        throw new Error("DeepSeek 返回了重复或缺失的成员任务");
      }
      for (const memberRef of expectedRefs) {
        if (!returnedRefs.has(memberRef)) throw new Error(`DeepSeek 缺少成员 ${memberRef} 的任务`);
      }
      const byRef = new Map(profiles.map((profile) => [profile.memberRef, profile]));
      const tasks = parsed.tasks.map((task) => {
        const profile = byRef.get(task.memberRef);
        if (!profile) throw new Error(`DeepSeek 返回未知成员 ${task.memberRef}`);
        return validateGeneratedTask(task, profile);
      });
      await db.weeklyChallengeGenerationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "SUCCEEDED",
          latencyMs: Date.now() - startedAt,
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
          validatedOutput: parsed as Prisma.InputJsonValue,
        },
      });
      logBatchProgress({
        batchNumber,
        attemptNumber,
        status: "succeeded",
        latencyMs: Date.now() - startedAt,
        streamEvents: completion.streamEvents,
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      });
      return tasks;
    } catch (error) {
      lastError = error;
      previousValidationError = retryCorrection(error);
      await db.weeklyChallengeGenerationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "FAILED",
          latencyMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message.slice(0, 1000) : "模型请求失败",
        },
      });
      logBatchProgress({
        batchNumber,
        attemptNumber,
        status: "failed",
        latencyMs: Date.now() - startedAt,
        errorCategory: generationFailureCategory(error),
      });
      if (offset < 3) {
        const retryDelay = offset * positiveIntegerEnv("DEEPSEEK_RETRY_BASE_MS", 1500);
        if (Date.now() + retryDelay >= deadline.getTime()) break;
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("DeepSeek 批次生成失败");
}

async function frozenAudience(periodStart: Date) {
  const previousWeekStart = new Date(periodStart.getTime() - 7 * DAY_MS);
  return db.user.findMany({
    where: {
      role: "MEMBER",
      active: true,
      createdAt: { lt: periodStart },
      videos: {
        some: {
          submittedAt: { gte: previousWeekStart, lt: periodStart },
          status: { not: "FAILED" },
        },
      },
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
}

export async function generateWeeklyChallengePeriod(input: {
  periodStart?: Date;
  retryFailed?: boolean;
  allowLateGeneration?: boolean;
} = {}) {
  const bounds = input.periodStart
    ? { ...nextShanghaiWeekBounds(new Date(input.periodStart.getTime() - 7 * DAY_MS)), start: input.periodStart }
    : nextShanghaiWeekBounds();
  const config = deepSeekConfig();
  const runId = crypto.randomUUID();
  let period = await db.weeklyChallengePeriod.findUnique({ where: { periodStart: bounds.start } });
  if (!period) {
    const audience = await frozenAudience(bounds.start);
    try {
      period = await db.weeklyChallengePeriod.create({
        data: {
          periodStart: bounds.start,
          periodEnd: bounds.end,
          claimEndsAt: bounds.claimEndsAt,
          status: "GENERATING",
          personalRewardBudget: audience.length * MAX_PERSONAL_REWARD,
          rewardPolicyVersion: REWARD_POLICY_VERSION,
          raceReward: RACE_REWARD,
          model: config.model,
          promptVersion: PROMPT_VERSION,
          audienceSnapshot: audience.map((row) => row.id),
          audienceCount: audience.length,
          generationRunId: runId,
          generationStartedAt: new Date(),
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      period = await db.weeklyChallengePeriod.findUniqueOrThrow({ where: { periodStart: bounds.start } });
    }
  } else {
    if (["READY", "ACTIVE", "CLOSED", "CANCELLED"].includes(period.status)) return period;
    const stale = !period.generationStartedAt || period.generationStartedAt < new Date(Date.now() - 15 * 60_000);
    if (period.status === "GENERATING" && !stale) return period;
    if (period.status === "FAILED" && !input.retryFailed) return period;
    const claimed = await db.weeklyChallengePeriod.updateMany({
      where: {
        id: period.id,
        status: period.status,
        generationRunId: period.generationRunId,
      },
      data: {
        status: "GENERATING",
        generationRunId: runId,
        generationStartedAt: new Date(),
        failureReason: null,
        model: config.model,
        promptVersion: PROMPT_VERSION,
        rewardPolicyVersion: REWARD_POLICY_VERSION,
      },
    });
    if (claimed.count !== 1) return db.weeklyChallengePeriod.findUniqueOrThrow({ where: { id: period.id } });
    period = await db.weeklyChallengePeriod.findUniqueOrThrow({ where: { id: period.id } });
  }
  if (period.generationRunId !== runId) return period;
  try {
    const deadline = input.allowLateGeneration
      ? new Date(period.periodStart.getTime() - 10 * 60 * 1000)
      : generationDeadline(period.periodStart);
    assertBeforeGenerationDeadline(deadline);
    const audience = z.array(z.string()).parse(period.audienceSnapshot);
    if (audience.length === 0) {
      await db.$transaction(async (tx) => {
        const claimed = await tx.weeklyChallengePeriod.updateMany({
          where: { id: period.id, status: "GENERATING", generationRunId: runId },
          data: { status: "READY", generatedAt: new Date(), failureReason: null },
        });
        if (claimed.count !== 1) throw new Error("周挑战生成租约已失效");
        await tx.auditLog.create({
          data: {
            action: "WEEKLY_CHALLENGE_PERIOD_GENERATED",
            entity: "WeeklyChallengePeriod",
            entityId: period.id,
            afterValue: {
              periodStart: period.periodStart,
              audienceCount: 0,
              totalRewards: 0,
              rewardBudget: period.personalRewardBudget,
              model: config.model,
              promptVersion: PROMPT_VERSION,
              rewardPolicyVersion: REWARD_POLICY_VERSION,
              reason: "上周没有提交视频的成员不生成本周任务",
            },
          },
        });
      });
      return db.weeklyChallengePeriod.findUniqueOrThrow({ where: { id: period.id } });
    }
    const profiles = await buildProfiles(period.periodStart, audience);
    if (profiles.length !== audience.length) throw new Error("冻结成员中存在已停用或缺失账号");
    const tasks: GeneratedTask[] = [];
    for (let index = 0; index < profiles.length; index += BATCH_SIZE) {
      tasks.push(...await requestBatch(
        period.id,
        runId,
        Math.floor(index / BATCH_SIZE),
        profiles.slice(index, index + BATCH_SIZE),
        deadline,
      ));
    }
    assertBeforeGenerationDeadline(deadline);
    const suggestedTotalRewards = tasks.reduce((sum, task) => sum + task.rewardPoints, 0);
    const totalRewards = suggestedTotalRewards;
    if (tasks.length !== period.audienceCount || totalRewards > period.personalRewardBudget) {
      throw new Error("周挑战覆盖人数或奖励预算校验失败");
    }
    const profileByRef = new Map(profiles.map((profile) => [profile.memberRef, profile]));
    await db.$transaction(async (tx) => {
      const claimed = await tx.weeklyChallengePeriod.updateMany({
        where: { id: period!.id, status: "GENERATING", generationRunId: runId },
        data: { status: "READY", generatedAt: new Date(), failureReason: null },
      });
      if (claimed.count !== 1) throw new Error("周挑战生成租约已失效");
      await tx.weeklyChallengeAssignment.deleteMany({ where: { periodId: period!.id } });
      await tx.weeklyChallengeAssignment.createMany({
        data: tasks.map((task) => {
          const profile = profileByRef.get(task.memberRef)!;
          return {
            periodId: period!.id,
            userId: task.userId,
            type: task.type as WeeklyChallengeType,
            baselineVideoCount: task.baselineVideoCount,
            baselineLikes: task.baselineLikes,
            weeklyVideoCounts: profile.weeklyVideoCounts,
            weeklyLikeSums: profile.weeklyLikeSums,
            targetVideoCount: task.targetVideoCount,
            targetLikes: task.targetLikes,
            rewardPoints: task.rewardPoints,
            rewardTiers: task.rewardTiers as Prisma.InputJsonValue,
            claimedRewardPoints: 0,
            claimedTier: -1,
            difficultyScore: task.difficultyScore,
            title: task.title,
            description: task.description,
            aiReason: task.reason,
          };
        }),
      });
      await tx.auditLog.create({
        data: {
          action: "WEEKLY_CHALLENGE_PERIOD_GENERATED",
          entity: "WeeklyChallengePeriod",
          entityId: period!.id,
          afterValue: {
            periodStart: period!.periodStart,
            audienceCount: tasks.length,
            suggestedTotalRewards,
            totalRewards,
            rewardBudget: period!.personalRewardBudget,
            rewardBudgetAdjusted: suggestedTotalRewards !== totalRewards,
            adjustedAssignmentCount: 0,
            model: config.model,
            promptVersion: PROMPT_VERSION,
            rewardPolicyVersion: REWARD_POLICY_VERSION,
          },
        },
      });
    });
    return db.weeklyChallengePeriod.findUniqueOrThrow({ where: { id: period.id } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "周挑战生成失败";
    await db.weeklyChallengePeriod.updateMany({
      where: { id: period.id, generationRunId: runId },
      data: { status: "FAILED", failureReason: message },
    });
    await sendOperationalAlert({
      source: "weekly-challenge-generator",
      severity: "critical",
      message: "个性化周挑战生成失败，本周不会发布任务",
      details: { periodId: period.id, periodStart: period.periodStart.toISOString(), error: message },
    });
    throw error;
  }
}

export async function runWeeklyChallengeMaintenance(now = new Date()) {
  const lifecycle = await activateAndCloseWeeklyChallenges(now);
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const isGenerationWindow = shifted.getUTCDay() === 0 && shifted.getUTCHours() >= 18 && shifted.getUTCHours() < 23;
  if (!isGenerationWindow) return { ...lifecycle, generated: false };
  const setting = await db.systemSetting.findUnique({ where: { key: "WEEKLY_CHALLENGES" }, select: { enabled: true } });
  if (!setting?.enabled) return { ...lifecycle, generated: false };
  const period = await generateWeeklyChallengePeriod();
  return { ...lifecycle, generated: period.status === "READY", periodId: period.id, status: period.status };
}

export const weeklyChallengeGenerationInternals = {
  targetBounds,
  buildRewardTiers,
  difficultyForTargets,
  validateGeneratedTask,
  buildPrompt,
  generationDeadline,
  parseModelOutput,
  readDeepSeekCompletion,
  deepSeekTimeoutMs,
  retryCorrection,
  refreshGenerationLease,
};

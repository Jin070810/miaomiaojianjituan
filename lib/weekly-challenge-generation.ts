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

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const BATCH_SIZE = 25;
const PERSONAL_REWARD_BUDGET = 10_000;
const RACE_REWARD = 2_000;
const PROMPT_VERSION = "weekly-challenge-v1";

type MemberProfile = {
  userId: string;
  memberRef: string;
  tenureDays: number;
  weeklyVideoCounts: number[];
  weeklyLikeSums: number[];
  baselineVideoCount: number;
  baselineLikes: number;
  bestVideoCount: number;
  bestLikes: number;
  previousChallengeCompletionRate: number;
  newMember: boolean;
};

const modelTaskSchema = z.object({
  memberRef: z.string().length(20),
  type: z.enum(["VIDEO_COUNT", "LIKE_SUM", "COMBINED"]),
  title: z.string().trim().min(2).max(40),
  description: z.string().trim().min(5).max(240),
  reason: z.string().trim().min(5).max(240),
  targetVideoCount: z.number().int().nonnegative().nullable(),
  targetLikes: z.number().int().nonnegative().nullable(),
  rewardPoints: z.number().int().min(10).max(1500),
});

function normalizeModelTask(task: z.infer<typeof modelTaskSchema>) {
  return {
    ...task,
    targetVideoCount: task.type === "LIKE_SUM" && task.targetVideoCount === 0
      ? null
      : task.targetVideoCount,
    targetLikes: task.type === "VIDEO_COUNT" && task.targetLikes === 0
      ? null
      : task.targetLikes,
  };
}

const taskSchema = modelTaskSchema.transform(normalizeModelTask);

const responseSchema = z.object({
  tasks: z.array(taskSchema).min(1).max(BATCH_SIZE),
});

type GeneratedTask = z.infer<typeof taskSchema> & {
  userId: string;
  difficultyScore: number;
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

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.floor((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function weekIndex(submittedAt: Date, baselineStart: Date) {
  return Math.floor((submittedAt.getTime() - baselineStart.getTime()) / (7 * DAY_MS));
}

async function buildProfiles(periodStart: Date, userIds: string[]) {
  const baselineStart = new Date(periodStart.getTime() - 28 * DAY_MS);
  const [users, videos, historicalTasks] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIds }, active: true, role: "MEMBER" },
      select: { id: true, createdAt: true },
    }),
    db.videoSubmission.findMany({
      where: {
        userId: { in: userIds },
        status: "APPROVED",
        submittedAt: { gte: baselineStart, lt: periodStart },
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
    const weeklyVideoCounts = [0, 0, 0, 0];
    const weeklyLikeSums = [0, 0, 0, 0];
    for (const video of videos) {
      if (video.userId !== user.id) continue;
      const index = weekIndex(video.submittedAt, baselineStart);
      if (index < 0 || index > 3) continue;
      weeklyVideoCounts[index] += 1;
      weeklyLikeSums[index] += video.likes ?? 0;
    }
    const record = history.get(user.id) ?? { completed: 0, total: 0 };
    const tenureDays = Math.max(0, Math.floor((periodStart.getTime() - user.createdAt.getTime()) / DAY_MS));
    return {
      userId: user.id,
      memberRef: opaqueMemberRef(periodStart, user.id),
      tenureDays,
      weeklyVideoCounts,
      weeklyLikeSums,
      baselineVideoCount: median(weeklyVideoCounts),
      baselineLikes: median(weeklyLikeSums),
      bestVideoCount: Math.max(...weeklyVideoCounts),
      bestLikes: Math.max(...weeklyLikeSums),
      previousChallengeCompletionRate: record.total ? Math.floor(record.completed * 100 / record.total) : 0,
      newMember: tenureDays < 14,
    };
  });
  return applyNewMemberCohortBaselines(raw);
}

function applyNewMemberCohortBaselines(profiles: MemberProfile[]) {
  const teamVideoMedian = median(profiles.map((profile) => profile.baselineVideoCount));
  const teamLikesMedian = median(profiles.map((profile) => profile.baselineLikes));
  return profiles.map((profile): MemberProfile => {
    if (!profile.newMember) return profile;
    const stage = Math.floor(profile.tenureDays / 7);
    const cohort = profiles.filter((candidate) =>
      candidate.newMember && Math.floor(candidate.tenureDays / 7) === stage);
    const cohortVideoMedian = median(cohort.map((candidate) => candidate.baselineVideoCount));
    const cohortLikesMedian = median(cohort.map((candidate) => candidate.baselineLikes));
    return {
      ...profile,
      baselineVideoCount: Math.max(profile.baselineVideoCount, cohortVideoMedian || teamVideoMedian),
      baselineLikes: Math.max(profile.baselineLikes, cohortLikesMedian || teamLikesMedian),
    };
  });
}

function targetBounds(profile: MemberProfile) {
  const minimumVideos = Math.max(profile.newMember ? 2 : 1, profile.baselineVideoCount + 1, Math.ceil(profile.baselineVideoCount * 1.2));
  const maximumVideos = Math.max(
    minimumVideos,
    Math.min(
      Math.max(2, profile.baselineVideoCount * 2),
      Math.max(2, Math.ceil(profile.bestVideoCount * 1.25)),
    ),
  );
  const minimumLikes = Math.max(profile.newMember ? 400 : 200, profile.baselineLikes + 200, Math.ceil(profile.baselineLikes * 1.2));
  const maximumLikes = Math.max(
    minimumLikes,
    Math.min(
      Math.max(400, profile.baselineLikes * 2),
      Math.max(400, Math.ceil(profile.bestLikes * 1.25)),
    ),
  );
  return { minimumVideos, maximumVideos, minimumLikes, maximumLikes };
}

function validateGeneratedTask(task: z.infer<typeof taskSchema>, profile: MemberProfile): GeneratedTask {
  const bounds = targetBounds(profile);
  if (profile.newMember && task.type === "LIKE_SUM") {
    throw new Error(`新人 ${profile.memberRef} 的任务必须包含至少 2 条通过视频`);
  }
  const videoRequired = task.type === "VIDEO_COUNT" || task.type === "COMBINED";
  const likesRequired = task.type === "LIKE_SUM" || task.type === "COMBINED";
  if (videoRequired) {
    if (task.targetVideoCount === null || task.targetVideoCount < bounds.minimumVideos || task.targetVideoCount > bounds.maximumVideos) {
      throw new Error(`成员 ${profile.memberRef} 的视频目标越界`);
    }
  } else if (task.targetVideoCount !== null) {
    throw new Error(`成员 ${profile.memberRef} 的视频目标不应存在`);
  }
  if (likesRequired) {
    if (task.targetLikes === null || task.targetLikes < bounds.minimumLikes || task.targetLikes > bounds.maximumLikes) {
      throw new Error(`成员 ${profile.memberRef} 的点赞目标越界`);
    }
  } else if (task.targetLikes !== null) {
    throw new Error(`成员 ${profile.memberRef} 的点赞目标不应存在`);
  }
  const videoDifficulty = task.targetVideoCount === null
    ? 0
    : Math.floor(task.targetVideoCount * 100 / Math.max(1, profile.baselineVideoCount));
  const likesDifficulty = task.targetLikes === null
    ? 0
    : Math.floor(task.targetLikes * 100 / Math.max(200, profile.baselineLikes));
  const difficultyScore = task.type === "COMBINED"
    ? Math.floor((videoDifficulty + likesDifficulty) / 2) + 15
    : Math.max(videoDifficulty, likesDifficulty);
  return { ...task, userId: profile.userId, difficultyScore };
}

function normalizeRewards(tasks: GeneratedTask[], budget = PERSONAL_REWARD_BUDGET) {
  const total = tasks.reduce((sum, task) => sum + task.rewardPoints, 0);
  if (total <= budget) return tasks;
  const minimumTotal = tasks.length * 10;
  if (minimumTotal > budget) throw new Error("周奖励预算不足以满足个人奖励下限");
  const distributable = budget - minimumTotal;
  const weights = tasks.map((task) =>
    Math.max(0, task.rewardPoints - 10) * Math.max(1, task.difficultyScore));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const normalized = tasks.map((task, index) => ({
    ...task,
    rewardPoints: Math.min(
      task.rewardPoints,
      10 + Math.floor(distributable * weights[index] / Math.max(1, totalWeight)),
    ),
  }));
  return normalized;
}

function buildPrompt(profiles: MemberProfile[]) {
  const members = profiles.map((profile) => ({
    memberRef: profile.memberRef,
    tenureDays: profile.tenureDays,
    weeklyVideoCounts: profile.weeklyVideoCounts,
    weeklyLikeSums: profile.weeklyLikeSums,
    baselineVideoCount: profile.baselineVideoCount,
    baselineLikes: profile.baselineLikes,
    bestVideoCount: profile.bestVideoCount,
    bestLikes: profile.bestLikes,
    previousChallengeCompletionRate: profile.previousChallengeCompletionRate,
    newMember: profile.newMember,
    allowedTargets: targetBounds(profile),
  }));
  return JSON.stringify({
    objective: "为每位剪辑团成员生成一个有挑战性但可完成的周任务。每位成员必须且只能出现一次。",
    policies: {
      types: ["VIDEO_COUNT", "LIKE_SUM", "COMBINED"],
      integerOnly: true,
      rewardRange: [10, 1500],
      preferHighChallengeLowReward: true,
      privacy: "不得推断或输出成员身份，不得在文案中比较或点名其他成员",
      copyLength: {
        title: "6-12 个中文字符",
        description: "18-40 个中文字符，只写本周行动要求",
        reason: "18-40 个中文字符，只说明匿名基线依据",
      },
      output: "只返回 JSON：{tasks:[{memberRef,type,title,description,reason,targetVideoCount,targetLikes,rewardPoints}]}",
    },
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
  const prompt = buildPrompt(profiles);
  const promptHash = crypto.createHash("sha256").update(prompt).digest("hex");
  let lastError: unknown;
  const previousAttempts = await db.weeklyChallengeGenerationAttempt.count({ where: { periodId, batchNumber } });
  for (let offset = 1; offset <= 3; offset += 1) {
    assertBeforeGenerationDeadline(deadline);
    await refreshGenerationLease(periodId, generationRunId);
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
  return db.user.findMany({
    where: { role: "MEMBER", active: true, createdAt: { lt: periodStart } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
}

export async function generateWeeklyChallengePeriod(input: { periodStart?: Date; retryFailed?: boolean } = {}) {
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
          personalRewardBudget: PERSONAL_REWARD_BUDGET,
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
      },
    });
    if (claimed.count !== 1) return db.weeklyChallengePeriod.findUniqueOrThrow({ where: { id: period.id } });
    period = await db.weeklyChallengePeriod.findUniqueOrThrow({ where: { id: period.id } });
  }
  if (period.generationRunId !== runId) return period;
  try {
    const deadline = generationDeadline(period.periodStart);
    assertBeforeGenerationDeadline(deadline);
    const audience = z.array(z.string()).parse(period.audienceSnapshot);
    if (audience.length === 0) throw new Error("周挑战没有可参与的启用成员");
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
    const normalized = normalizeRewards(tasks, period.personalRewardBudget);
    const totalRewards = normalized.reduce((sum, task) => sum + task.rewardPoints, 0);
    if (normalized.length !== period.audienceCount || totalRewards > period.personalRewardBudget) {
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
        data: normalized.map((task) => {
          const profile = profileByRef.get(task.memberRef)!;
          return {
            periodId: period!.id,
            userId: task.userId,
            type: task.type as WeeklyChallengeType,
            baselineVideoCount: profile.baselineVideoCount,
            baselineLikes: profile.baselineLikes,
            weeklyVideoCounts: profile.weeklyVideoCounts,
            weeklyLikeSums: profile.weeklyLikeSums,
            targetVideoCount: task.targetVideoCount,
            targetLikes: task.targetLikes,
            rewardPoints: task.rewardPoints,
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
            audienceCount: normalized.length,
            suggestedTotalRewards,
            totalRewards,
            rewardBudget: period!.personalRewardBudget,
            rewardBudgetAdjusted: suggestedTotalRewards !== totalRewards,
            adjustedAssignmentCount: normalized.filter((task, index) =>
              task.rewardPoints !== tasks[index].rewardPoints).length,
            model: config.model,
            promptVersion: PROMPT_VERSION,
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
  median,
  applyNewMemberCohortBaselines,
  targetBounds,
  validateGeneratedTask,
  normalizeRewards,
  buildPrompt,
  generationDeadline,
  normalizeModelTask,
  parseModelOutput,
  readDeepSeekCompletion,
  deepSeekTimeoutMs,
  refreshGenerationLease,
};

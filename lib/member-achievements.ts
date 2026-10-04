import { Prisma, WeeklyChallengeAssignmentStatus } from "@prisma/client";
import { db } from "./db";
import { memberParticipantRoles } from "./member-roles";
import { createNotification } from "./notifications";
import { periodBounds } from "./rankings";
import { consecutiveMonthKeys, readAchievementMetrics } from "./member-achievement-metrics";

type Transaction = Prisma.TransactionClient;
type ApprovedVideo = { id: string; submittedAt: Date; likes: number | null; views: number | null; commentCount: number | null };

export const GROWTH_LEVELS = [
  { level: 1, name: "剪辑新芽", minimumExperience: 0 },
  { level: 2, name: "成长剪辑师", minimumExperience: 500 },
  { level: 3, name: "高光剪辑师", minimumExperience: 1_500 },
  { level: 4, name: "王牌剪辑师", minimumExperience: 3_500 },
  { level: 5, name: "星耀剪辑师", minimumExperience: 7_000 },
] as const;

export const ACHIEVEMENT_CATALOG = [
  { code: "FIRST_APPROVED", title: "初剪高光", description: "完成第一条通过切片", kind: "videos", threshold: 1 },
  { code: "VIDEOS_10", title: "稳定开剪", description: "累计通过 10 条切片", kind: "videos", threshold: 10 },
  { code: "VIDEOS_50", title: "高光成册", description: "累计通过 50 条切片", kind: "videos", threshold: 50 },
  { code: "VIDEOS_100", title: "百剪成光", description: "累计通过 100 条切片", kind: "videos", threshold: 100 },
  { code: "LIKES_10000", title: "互动新星", description: "累计收获 1 万点赞", kind: "likes", threshold: 10_000 },
  { code: "LIKES_100000", title: "人气剪辑师", description: "累计收获 10 万点赞", kind: "likes", threshold: 100_000 },
  { code: "VIEWS_100000", title: "万众注目", description: "累计播放 10 万", kind: "views", threshold: 100_000 },
  { code: "VIEWS_1000000", title: "百万高光", description: "累计播放 100 万", kind: "views", threshold: 1_000_000 },
  { code: "ACTIVE_MONTHS_3", title: "持续开剪", description: "连续活跃 3 个月", kind: "months", threshold: 3 },
  { code: "ACTIVE_MONTHS_6", title: "长线创作", description: "连续活跃 6 个月", kind: "months", threshold: 6 },
  { code: "CHALLENGES_4", title: "挑战伙伴", description: "完成 4 次周挑战", kind: "challenges", threshold: 4 },
] as const;

export const BIRTHDAY_ACHIEVEMENT = { code: "BIRTHDAY_STAR", title: "生日星光", description: "参加一次生日星愿", kind: "birthday", threshold: 1 } as const;

export function calculateGrowthExperience(video: ApprovedVideo) {
  return 100 + Math.floor((video.likes ?? 0) / 100) + Math.floor((video.views ?? 0) / 1_000) + (video.commentCount ?? 0) * 5;
}

export function calculateGoalEngagement(video: ApprovedVideo) {
  return (video.likes ?? 0) + Math.floor((video.views ?? 0) / 100) + (video.commentCount ?? 0) * 10;
}

function levelFor(experience: number) {
  return [...GROWTH_LEVELS].reverse().find((row) => experience >= row.minimumExperience) ?? GROWTH_LEVELS[0];
}

function shanghaiMonthKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}

export function countConsecutiveActiveMonths(videos: ApprovedVideo[]) {
  return consecutiveMonthKeys(videos.map((video) => shanghaiMonthKey(video.submittedAt)));
}

export function calculateMonthlyGoalTargets(videos: ApprovedVideo[], monthStart: Date) {
  const windowStart = new Date(monthStart.getTime() - 56 * 86_400_000);
  const baseline = videos.filter((video) => video.submittedAt >= windowStart && video.submittedAt < monthStart);
  const baselineVideos = Math.ceil(baseline.length / 2);
  const baselineEngagement = Math.ceil(baseline.reduce((total, video) => total + calculateGoalEngagement(video), 0) / 2);
  return {
    baselineVideos,
    baselineEngagement,
    targetVideos: Math.max(1, Math.ceil(baselineVideos * 1.1)),
    targetEngagement: Math.max(100, Math.ceil(baselineEngagement * 1.1)),
  };
}

async function approvedVideosFor(tx: Transaction, userId: string) {
  return tx.videoSubmission.findMany({
    where: { userId, status: "APPROVED" },
    select: { id: true, submittedAt: true, likes: true, views: true, commentCount: true },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
  });
}

async function ensureMonthlyGoal(tx: Transaction, userId: string, metrics: Awaited<ReturnType<typeof readAchievementMetrics>>) {
  const { monthStart, targets } = metrics;
  // 后台重试复用原有月份目标，不因视频撤销或重新计算而改写已锁定的基线。
  return tx.memberMonthlyGoal.upsert({
    where: { userId_monthStart: { userId, monthStart } },
    create: { userId, monthStart, ...targets },
    update: {},
  });
}

async function syncAchievements(tx: Transaction, userId: string, computed: Awaited<ReturnType<typeof readAchievementMetrics>>, reference: Date) {
  const [profile, completedChallenges, existing] = await Promise.all([
    tx.memberGrowthProfile.findUnique({ where: { userId } }),
    tx.weeklyChallengeAssignment.count({ where: { userId, status: { in: [WeeklyChallengeAssignmentStatus.COMPLETED, WeeklyChallengeAssignmentStatus.CLAIMED] } } }),
    tx.memberAchievement.findMany({ where: { userId }, select: { code: true } }),
  ]);
  const metrics: Record<(typeof ACHIEVEMENT_CATALOG)[number]["kind"], number> = {
    ...computed.metrics,
    challenges: completedChallenges,
  };
  const experience = computed.experience;
  const level = levelFor(experience);
  const beforeLevel = profile?.level ?? 1;
  await tx.memberGrowthProfile.upsert({
    where: { userId },
    create: { userId, experience, level: level.level, calculatedAt: reference },
    update: { experience, level: level.level, calculatedAt: reference },
  });
  if (level.level > beforeLevel) {
    await createNotification(tx, {
      userId, type: "ACHIEVEMENT", title: `成长等级提升至 ${level.name}`,
      body: `你已积累 ${experience.toLocaleString()} 成长经验，继续创作下一束高光吧。`,
      entityType: "MemberGrowthProfile", entityId: userId, metadata: { level: level.level, experience },
      dedupeKey: `growth-level:${userId}:${level.level}`,
    });
  }
  const qualified = ACHIEVEMENT_CATALOG.filter((achievement) => metrics[achievement.kind] >= achievement.threshold);
  const qualifiedCodes = new Set<string>(qualified.map((achievement) => achievement.code));
  const catalogCodes = new Set<string>(ACHIEVEMENT_CATALOG.map((achievement) => achievement.code));
  const existingCodes = new Set(existing.filter((achievement) => catalogCodes.has(achievement.code)).map((achievement) => achievement.code));
  const gained = qualified.filter((achievement) => !existingCodes.has(achievement.code));
  const revoked = existing.filter((achievement) => catalogCodes.has(achievement.code) && !qualifiedCodes.has(achievement.code)).map((achievement) => achievement.code);
  if (revoked.length) await tx.memberAchievement.deleteMany({ where: { userId, code: { in: revoked } } });
  for (const achievement of gained) {
    // 并发补齐可能已为该成员创建过同一枚勋章；原生 upsert 单语句竞态安全。
    await tx.memberAchievement.upsert({
      where: { userId_code: { userId, code: achievement.code } },
      create: { userId, code: achievement.code, metadata: { metric: achievement.kind, value: metrics[achievement.kind] } },
      update: {},
    });
    await createNotification(tx, {
      userId, type: "ACHIEVEMENT", title: `获得勋章：${achievement.title}`, body: achievement.description,
      entityType: "MemberAchievement", entityId: achievement.code, metadata: { code: achievement.code },
      dedupeKey: `achievement:${userId}:${achievement.code}`,
    });
  }
  return { profile: { experience, level: level.level }, metrics, gained };
}

export async function reconcileMemberAchievements(tx: Transaction, userId: string, reference = new Date()) {
  // Only called by the fenced background projection transaction, never by GET
  // or a points transaction. Aggregate in PostgreSQL rather than transfer history.
  const computed = await readAchievementMetrics(tx, userId, reference);
  const growth = await syncAchievements(tx, userId, computed, reference);
  const initialGoal = await ensureMonthlyGoal(tx, userId, computed);
  const progress = computed.progress;
  const goal = await tx.memberMonthlyGoal.update({ where: { id: initialGoal.id }, data: {
    progressVideos: progress.videos, progressEngagement: progress.engagement, calculatedAt: reference,
  } });
  if (!goal.completedAt && progress.videos >= goal.targetVideos && progress.engagement >= goal.targetEngagement) {
    const completedAt = reference;
    await tx.memberMonthlyGoal.update({ where: { id: goal.id }, data: { completedAt } });
    await createNotification(tx, {
      userId, type: "ACHIEVEMENT", title: "本月成长目标已完成", body: "你的持续创作正在积累成新的高光。",
      entityType: "MemberMonthlyGoal", entityId: goal.id, metadata: { monthStart: goal.monthStart.toISOString() },
      dedupeKey: `monthly-goal:${userId}:${goal.monthStart.toISOString()}:completed`,
    });
    return { ...growth, goal: { ...goal, completedAt }, progress };
  }
  if (goal.completedAt && (progress.videos < goal.targetVideos || progress.engagement < goal.targetEngagement)) {
    const reopened = await tx.memberMonthlyGoal.update({ where: { id: goal.id }, data: { completedAt: null } });
    return { ...growth, goal: reopened, progress };
  }
  return { ...growth, goal, progress };
}

export async function getMemberAchievements(userId: string, reference = new Date()) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const monthStart = periodBounds("month", reference).start;
    const [profile, achievements, highlights, reviews, goal, refresh] = await Promise.all([
      tx.memberGrowthProfile.findUnique({ where: { userId } }),
      tx.memberAchievement.findMany({ where: { userId }, orderBy: { earnedAt: "desc" } }),
      tx.videoSubmission.findMany({
        where: { userId, status: "APPROVED" },
        select: { id: true, sourceUrl: true, caption: true, coverUrl: true, likes: true, views: true, commentCount: true, submittedAt: true },
        orderBy: [{ likes: "desc" }, { views: "desc" }, { submittedAt: "desc" }], take: 3,
      }),
      tx.memberMonthlyReview.findMany({ where: { userId }, orderBy: { monthStart: "desc" }, take: 6 }),
      tx.memberMonthlyGoal.findUnique({ where: { userId_monthStart: { userId, monthStart } } }),
      tx.memberAchievementRefresh.findUnique({ where: { userId }, select: { pending: true, requestedAt: true, failures: true } }),
    ]);
    const fallbackProfile = { userId, experience: 0, level: 1, calculatedAt: null };
    const selectedProfile = profile ?? fallbackProfile;
    const pending = !profile || !goal?.calculatedAt || !refresh || refresh.pending;
    const selectedGoal = goal ?? { userId, monthStart, baselineVideos: 0, baselineEngagement: 0,
      targetVideos: 1, targetEngagement: 100, completedAt: null, progressVideos: 0, progressEngagement: 0 };
    return {
      generatedAt: reference,
      projection: { state: pending ? "pending" as const : "ready" as const, initialized: Boolean(profile && goal?.calculatedAt), calculatedAt: profile?.calculatedAt ?? null,
        requestedAt: refresh?.requestedAt ?? null, delayed: (refresh?.failures ?? 0) > 0 },
      profile: { ...selectedProfile, name: levelFor(selectedProfile.experience).name, nextLevel: GROWTH_LEVELS.find((row) => row.minimumExperience > selectedProfile.experience) ?? null },
      achievements: [
        ...ACHIEVEMENT_CATALOG.map((item) => ({ ...item, earnedAt: achievements.find((achievement) => achievement.code === item.code)?.earnedAt ?? null })),
        { ...BIRTHDAY_ACHIEVEMENT, earnedAt: achievements.find((achievement) => achievement.code === BIRTHDAY_ACHIEVEMENT.code)?.earnedAt ?? null },
      ],
      goal: { ...selectedGoal, progress: { videos: selectedGoal.progressVideos, engagement: selectedGoal.progressEngagement } },
      highlights,
      reviews,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 5_000 });
}

export async function runMemberGrowthMonthlyMaintenance(reference = new Date()) {
  const previousMonth = periodBounds("month", new Date(periodBounds("month", reference).start.getTime() - 1)).start;
  const previousEnd = periodBounds("month", previousMonth).end;
  const users = await db.user.findMany({ where: { active: true, role: { in: memberParticipantRoles } }, select: { id: true } });
  const existing = await db.memberMonthlyReview.findMany({ where: { monthStart: previousMonth }, select: { userId: true } });
  const reviewed = new Set(existing.map((row) => row.userId));
  for (const user of users.filter((row) => !reviewed.has(row.id))) {
    await db.$transaction(async (tx) => {
      const videos = await approvedVideosFor(tx, user.id);
      const goal = await tx.memberMonthlyGoal.findUnique({ where: { userId_monthStart: { userId: user.id, monthStart: previousMonth } } });
      const monthBeforePrevious = periodBounds("month", new Date(previousMonth.getTime() - 1)).start;
      const earlierReview = await tx.memberMonthlyReview.findUnique({ where: { userId_monthStart: { userId: user.id, monthStart: monthBeforePrevious } } });
      const rows = videos.filter((video) => video.submittedAt >= previousMonth && video.submittedAt < previousEnd);
      const baseline = calculateMonthlyGoalTargets(videos, previousMonth);
      const highlight = [...rows].sort((left, right) => calculateGoalEngagement(right) - calculateGoalEngagement(left) || right.submittedAt.getTime() - left.submittedAt.getTime())[0];
      await tx.memberMonthlyReview.upsert({
        where: { userId_monthStart: { userId: user.id, monthStart: previousMonth } },
        create: {
          userId: user.id, monthStart: previousMonth, approvedVideos: rows.length,
          engagement: rows.reduce((sum, video) => sum + calculateGoalEngagement(video), 0), goalCompleted: Boolean(goal?.completedAt),
          baselineVideos: baseline.baselineVideos, baselineEngagement: baseline.baselineEngagement,
          previousVideos: earlierReview?.approvedVideos ?? 0, previousEngagement: earlierReview?.engagement ?? 0,
          highlightVideoId: highlight?.id,
        },
        update: {},
      });
    });
  }
  return { reviewed: users.length - reviewed.size };
}

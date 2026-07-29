import { db } from "./db";
import { periodBounds } from "./rankings";
import { memberParticipantRoles } from "./member-roles";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const TREND_WEEKS = 8;

export const MEMBER_GROWTH_TIMEZONE = "Asia/Shanghai";

export type GrowthMetric = {
  start: Date;
  end: Date;
  approvedVideos: number;
  likes: number;
  videoPoints: number;
  averageLikes: number;
};

export type GrowthDelta = {
  approvedVideos: number;
  likes: number;
  videoPoints: number;
};

type ApprovedVideoMetricRow = {
  id: string;
  sourceUrl: string;
  submittedAt: Date;
  likes: number | null;
  points: number;
};

type ParticipationRow = {
  userId: string;
  status: string;
  likes: number | null;
  points: number;
};

export function growthWindows(reference = new Date()) {
  const currentWeekBounds = periodBounds("week", reference);
  const elapsed = Math.min(WEEK_MS, Math.max(0, reference.getTime() - currentWeekBounds.start.getTime()));
  const currentEnd = new Date(currentWeekBounds.start.getTime() + elapsed);
  const previousStart = new Date(currentWeekBounds.start.getTime() - WEEK_MS);
  const previousEnd = new Date(previousStart.getTime() + elapsed);
  const month = periodBounds("month", reference);
  const trendStart = new Date(currentWeekBounds.start.getTime() - (TREND_WEEKS - 1) * WEEK_MS);
  return {
    currentWeek: { start: currentWeekBounds.start, end: currentEnd },
    previousWeekSameWindow: { start: previousStart, end: previousEnd },
    month: { start: month.start, end: reference < month.end ? reference : month.end },
    trend: { start: trendStart, end: currentWeekBounds.end },
  };
}

export function summarizeApprovedVideos(
  videos: Array<Pick<ApprovedVideoMetricRow, "submittedAt" | "likes" | "points">>,
  start: Date,
  end: Date,
): GrowthMetric {
  const rows = videos.filter((video) => video.submittedAt >= start && video.submittedAt < end);
  const likes = rows.reduce((sum, video) => sum + (video.likes ?? 0), 0);
  const videoPoints = rows.reduce((sum, video) => sum + video.points, 0);
  return {
    start,
    end,
    approvedVideos: rows.length,
    likes,
    videoPoints,
    averageLikes: rows.length > 0 ? Math.floor(likes / rows.length) : 0,
  };
}

export function growthDelta(current: GrowthMetric, previous: GrowthMetric): GrowthDelta {
  return {
    approvedVideos: current.approvedVideos - previous.approvedVideos,
    likes: current.likes - previous.likes,
    videoPoints: current.videoPoints - previous.videoPoints,
  };
}

export function buildGrowthTrend(
  videos: Array<Pick<ApprovedVideoMetricRow, "submittedAt" | "likes" | "points">>,
  currentWeekStart: Date,
  reference = new Date(),
) {
  return Array.from({ length: TREND_WEEKS }, (_, index) => {
    const start = new Date(currentWeekStart.getTime() - (TREND_WEEKS - 1 - index) * WEEK_MS);
    const end = new Date(start.getTime() + WEEK_MS);
    return {
      ...summarizeApprovedVideos(videos, start, end),
      complete: end <= reference,
    };
  });
}

export async function getMemberGrowth(userId: string, reference = new Date()) {
  const windows = growthWindows(reference);
  const queryStart = windows.trend.start < windows.month.start ? windows.trend.start : windows.month.start;
  const videos = await db.videoSubmission.findMany({
    where: {
      userId,
      status: "APPROVED",
      submittedAt: { gte: queryStart, lt: reference },
    },
    select: {
      id: true,
      sourceUrl: true,
      submittedAt: true,
      likes: true,
      points: true,
    },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
  });
  const currentWeek = summarizeApprovedVideos(videos, windows.currentWeek.start, windows.currentWeek.end);
  const previousWeekSameWindow = summarizeApprovedVideos(
    videos,
    windows.previousWeekSameWindow.start,
    windows.previousWeekSameWindow.end,
  );
  const topVideos = videos
    .filter((video) => video.submittedAt >= windows.month.start && video.submittedAt < windows.month.end)
    .sort((left, right) =>
      (right.likes ?? 0) - (left.likes ?? 0)
      || right.points - left.points
      || left.submittedAt.getTime() - right.submittedAt.getTime()
      || left.id.localeCompare(right.id))
    .slice(0, 3);

  return {
    timezone: MEMBER_GROWTH_TIMEZONE,
    generatedAt: reference,
    currentWeek,
    previousWeekSameWindow,
    delta: growthDelta(currentWeek, previousWeekSameWindow),
    trend: buildGrowthTrend(videos, periodBounds("week", reference).start, reference),
    topVideos,
  };
}

function summarizeParticipation(rows: ParticipationRow[]) {
  const submitters = new Set(rows.map((row) => row.userId)).size;
  const approvedRows = rows.filter((row) => row.status === "APPROVED");
  const likes = approvedRows.reduce((sum, row) => sum + (row.likes ?? 0), 0);
  return {
    submitters,
    approvedSubmitters: new Set(approvedRows.map((row) => row.userId)).size,
    approvedVideos: approvedRows.length,
    likes,
    videoPoints: approvedRows.reduce((sum, row) => sum + row.points, 0),
  };
}

export async function getAdminMemberGrowth(reference = new Date()) {
  const windows = growthWindows(reference);
  const [activeMembers, currentRows, previousRows, challenge] = await Promise.all([
    db.user.count({ where: { active: true, role: { in: memberParticipantRoles } } }),
    db.videoSubmission.findMany({
      where: {
        submittedAt: { gte: windows.currentWeek.start, lt: windows.currentWeek.end },
        user: { active: true, role: { in: memberParticipantRoles } },
      },
      select: { userId: true, status: true, likes: true, points: true },
    }),
    db.videoSubmission.findMany({
      where: {
        submittedAt: { gte: windows.previousWeekSameWindow.start, lt: windows.previousWeekSameWindow.end },
        user: { active: true, role: { in: memberParticipantRoles } },
      },
      select: { userId: true, status: true, likes: true, points: true },
    }),
    db.weeklyChallengePeriod.findFirst({
      where: { periodStart: { lte: reference }, periodEnd: { gt: reference } },
      orderBy: { periodStart: "desc" },
      select: { assignments: { select: { status: true } } },
    }),
  ]);
  const currentWeek = summarizeParticipation(currentRows);
  const previousWeekSameWindow = summarizeParticipation(previousRows);
  const assignments = challenge?.assignments ?? [];

  return {
    timezone: MEMBER_GROWTH_TIMEZONE,
    generatedAt: reference,
    activeMembers,
    currentWeek,
    previousWeekSameWindow,
    delta: {
      submitters: currentWeek.submitters - previousWeekSameWindow.submitters,
      approvedSubmitters: currentWeek.approvedSubmitters - previousWeekSameWindow.approvedSubmitters,
      approvedVideos: currentWeek.approvedVideos - previousWeekSameWindow.approvedVideos,
      likes: currentWeek.likes - previousWeekSameWindow.likes,
      videoPoints: currentWeek.videoPoints - previousWeekSameWindow.videoPoints,
    },
    challenge: {
      covered: assignments.length,
      completed: assignments.filter((assignment) => ["COMPLETED", "CLAIMED"].includes(assignment.status)).length,
      claimed: assignments.filter((assignment) => assignment.status === "CLAIMED").length,
    },
  };
}

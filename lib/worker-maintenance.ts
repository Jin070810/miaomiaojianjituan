import { db } from "./db";
import { sendOperationalAlert } from "./alerts";
import { recoverStaleVideoSubmissions } from "./video-jobs";
import { runWeeklyChallengeMaintenance } from "./weekly-challenge-generation";
import { runMemberClearanceMaintenance } from "./member-clearance";
import { runMemberGrowthMonthlyMaintenance } from "./member-achievements";
import { runBirthdayMaintenance } from "./birthdays";

type MaintenanceTask<T> = {
  name: string;
  source: string;
  run: () => Promise<T>;
};

export type WorkerMaintenanceCycleResult = {
  recovery: Awaited<ReturnType<typeof recoverStaleVideoSubmissions>> | null;
  challengeMaintenance: Awaited<ReturnType<typeof runWeeklyChallengeMaintenance>> | null;
  clearanceMaintenance: Awaited<ReturnType<typeof runMemberClearanceMaintenance>> | null;
  failures: Array<{ name: string; source: string; error: string }>;
};

// Worker 每分钟的维护循环：六个子系统彼此独立，任何一个抛错都不应吞掉其余
// 结果或让当分钟的周挑战补跑丢失。告警按任务自身的来源上报，而不是统一算在
// 视频链路头上。
export async function runWorkerMaintenanceCycle(): Promise<WorkerMaintenanceCycleResult> {
  const tasks: Array<MaintenanceTask<unknown>> = [
    { name: "video-recovery", source: "video-worker", run: () => recoverStaleVideoSubmissions() },
    { name: "session-cleanup", source: "video-worker", run: () => db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }) },
    { name: "weekly-challenge", source: "weekly-challenge-worker", run: () => runWeeklyChallengeMaintenance() },
    { name: "member-clearance", source: "member-clearance", run: () => runMemberClearanceMaintenance() },
    { name: "member-growth", source: "member-achievements", run: () => runMemberGrowthMonthlyMaintenance() },
    { name: "birthday", source: "birthday", run: () => runBirthdayMaintenance() },
  ];
  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  const byName = new Map<string, PromiseSettledResult<unknown>>();
  tasks.forEach((task, index) => byName.set(task.name, settled[index]));
  const failures: WorkerMaintenanceCycleResult["failures"] = [];
  for (const [index, task] of tasks.entries()) {
    const result = settled[index];
    if (result.status === "fulfilled") continue;
    const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
    failures.push({ name: task.name, source: task.source, error });
    console.error(`[worker-maintenance] ${task.name} failed`, result.reason);
    await sendOperationalAlert({
      source: task.source,
      severity: "warning",
      message: `Worker 维护任务失败：${task.name}`,
      details: { error },
    }).catch(() => undefined);
  }
  const recovery = byName.get("video-recovery");
  const challenge = byName.get("weekly-challenge");
  const clearance = byName.get("member-clearance");
  return {
    recovery: recovery?.status === "fulfilled" ? recovery.value as Awaited<ReturnType<typeof recoverStaleVideoSubmissions>> : null,
    challengeMaintenance: challenge?.status === "fulfilled" ? challenge.value as Awaited<ReturnType<typeof runWeeklyChallengeMaintenance>> : null,
    clearanceMaintenance: clearance?.status === "fulfilled" ? clearance.value as Awaited<ReturnType<typeof runMemberClearanceMaintenance>> : null,
    failures,
  };
}

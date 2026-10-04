import { sendOperationalAlert } from "./alerts";
import { getAchievementRefreshStatus, runMemberAchievementRefreshBatch } from "./member-achievement-jobs";

export function startMemberAchievementRefreshWorker() {
  let closing = false;
  let running: Promise<void> | null = null;
  let lastStatusCheck = 0;
  const poll = () => {
    if (closing || running) return;
    running = (async () => {
      try {
        const result = await runMemberAchievementRefreshBatch();
        if (result.failed) await sendOperationalAlert({ source: "member-achievements", severity: "warning",
          message: "成长档案更新存在失败任务，已安排重试", details: { failed: result.failed } });
        if (Date.now() - lastStatusCheck >= 60_000) {
          lastStatusCheck = Date.now();
          const status = await getAchievementRefreshStatus();
          if (status.oldestRequestedAt && Date.now() - status.oldestRequestedAt.getTime() > 5 * 60_000) {
            await sendOperationalAlert({ source: "member-achievements", severity: "warning",
              message: "成长档案更新积压超过五分钟", details: { pending: status.pending, delayed: status.delayed } });
          }
        }
      } catch {
        await sendOperationalAlert({ source: "member-achievements", severity: "warning", message: "成长档案后台更新暂时不可用，将在下一轮重试" }).catch(() => undefined);
      }
    })().finally(() => { running = null; });
  };
  const timer = setInterval(poll, 5_000);
  timer.unref();
  poll();
  return async () => {
    closing = true;
    clearInterval(timer);
    await running;
  };
}

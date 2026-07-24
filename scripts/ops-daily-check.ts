import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../lib/db";
import { getVideoQueueMetrics } from "../lib/video-jobs";
import { checkRateLimitStore } from "../lib/rate-limit";
import { checkWorkerHeartbeat } from "../lib/worker-health";
import { sendOperationalAlert } from "../lib/alerts";

async function main() {
  const accounts = await db.pointAccount.findMany({ select: { id: true, balance: true } });
  const ledgerTotals = await db.pointLedger.groupBy({ by: ["accountId"], _sum: { amount: true } });
  const totals = new Map(ledgerTotals.map((row) => [row.accountId, row._sum.amount ?? 0]));
  const balanceMismatches = accounts.filter((row) => row.balance !== (totals.get(row.id) ?? 0)).length;
  const duplicatePhotoIds = await db.$queryRaw<Array<{ photoId: string }>>`
    SELECT "photoId"
    FROM "VideoSubmission"
    WHERE "photoId" IS NOT NULL AND "status" IN ('PROCESSING', 'PENDING_REVIEW', 'APPROVED')
    GROUP BY "photoId"
    HAVING COUNT(*) > 1
  `;
  const invalidOrders = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "RedemptionOrder"
    WHERE quantity < 1 OR "unitCost" < 1 OR "totalCost" <> quantity * "unitCost"
    LIMIT 20
  `;
  const [redis, worker, queue] = await Promise.all([
    checkRateLimitStore().catch(() => "unavailable"),
    checkWorkerHeartbeat().catch(() => "unavailable"),
    getVideoQueueMetrics().catch(() => null),
  ]);
  const backupDirectory = path.resolve(process.env.BACKUP_DIRECTORY ?? "backups");
  const backups = fs.existsSync(backupDirectory)
    ? fs.readdirSync(backupDirectory).filter((file) => file.endsWith(".dump")).sort().reverse()
    : [];
  const newestBackup = backups[0] ? path.join(backupDirectory, backups[0]) : null;
  const backupAgeHours = newestBackup ? (Date.now() - fs.statSync(newestBackup).mtimeMs) / 3_600_000 : null;
  const backupHash = newestBackup ? crypto.createHash("sha256").update(fs.readFileSync(newestBackup)).digest("hex") : null;
  const checksum = newestBackup && fs.existsSync(`${newestBackup}.sha256`) ? fs.readFileSync(`${newestBackup}.sha256`, "utf8").trim().split(/\s+/)[0] : null;
  const issues = [
    ...(balanceMismatches ? [`${balanceMismatches} 个积分账户余额不一致`] : []),
    ...(duplicatePhotoIds.length ? [`${duplicatePhotoIds.length} 个有效视频存在重复 photoId`] : []),
    ...(invalidOrders.length ? [`${invalidOrders.length} 个兑换订单数据不一致`] : []),
    ...(redis !== "ok" ? [`Redis 状态：${redis}`] : []),
    ...(worker !== "ok" ? [`Worker 状态：${worker}`] : []),
    ...(queue && queue.waiting > Number(process.env.QUEUE_WAITING_ALERT_THRESHOLD ?? 1000) ? [`队列等待任务：${queue.waiting}`] : []),
    ...(!newestBackup ? ["未找到数据库备份"] : []),
    ...(backupAgeHours !== null && backupAgeHours > Number(process.env.BACKUP_MAX_AGE_HOURS ?? 26) ? [`最新备份已 ${Math.floor(backupAgeHours)} 小时未更新`] : []),
    ...(backupHash && checksum && backupHash !== checksum ? ["最新备份 SHA-256 校验失败"] : []),
  ];
  const report = { checkedAt: new Date().toISOString(), balanceMismatches, duplicatePhotoIds: duplicatePhotoIds.length, invalidOrders: invalidOrders.length, redis, worker, queue, newestBackup, backupAgeHours, issues };
  console.log(JSON.stringify(report, null, 2));
  if (issues.length) {
    await sendOperationalAlert({ source: "ops-daily-check", severity: "critical", message: "每日积分中心巡检发现异常", details: report });
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(error);
  await sendOperationalAlert({ source: "ops-daily-check", severity: "critical", message: "每日积分中心巡检执行失败", details: { error: error instanceof Error ? error.message : String(error) } });
  process.exitCode = 1;
}).finally(() => db.$disconnect());

import "dotenv/config";
import { db } from "../lib/db";
import { inspectRedemptionReconciliation, reconcileRedemptionOrders } from "../lib/redemption-reconciliation";

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const action = readArg("--action") ?? "dry-run";
  const cutoffText = readArg("--cutoff");
  const excludedGiftName = readArg("--excluded-gift-name") ?? "悠哈奶糖条";
  const reason = readArg("--reason") ?? "订单资料同步";
  const actorIds = (process.env.ADMIN_KUAISHOU_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!["dry-run", "apply"].includes(action)) throw new Error("--action 必须是 dry-run 或 apply");
  if (!cutoffText) throw new Error("必须提供 --cutoff ISO 时间，先 dry-run 再使用同一 cutoff apply");
  const cutoff = new Date(cutoffText);
  if (Number.isNaN(cutoff.getTime())) throw new Error("--cutoff 不是有效 ISO 时间");
  if (!excludedGiftName.trim()) throw new Error("--excluded-gift-name 不能为空");

  const scope = await inspectRedemptionReconciliation({ cutoff, excludedGiftName: excludedGiftName.trim() });
  console.log(JSON.stringify({
    action,
    cutoff: cutoff.toISOString(),
    excludedGiftName: excludedGiftName.trim(),
    excludedCount: scope.excluded.length,
    excluded: scope.excluded.map((order) => ({ id: order.id, status: order.status, totalCost: order.totalCost })),
    fulfillCount: scope.fulfill.length,
  }, null, 2));
  if (action === "dry-run") {
    if (scope.excluded.length !== 1) throw new Error(`目标取消订单应为 1 条，实际找到 ${scope.excluded.length} 条`);
    return;
  }
  if (actorIds.length === 0) throw new Error("缺少 ADMIN_KUAISHOU_IDS，无法写入审计操作者");
  const actor = await db.user.findFirst({
    where: { kuaishouId: { in: actorIds }, role: "ADMIN", active: true },
    select: { id: true },
  });
  if (!actor) throw new Error("ADMIN_KUAISHOU_IDS 中没有有效管理员账号");
  const result = await reconcileRedemptionOrders({
    actorId: actor.id,
    cutoff,
    excludedGiftName: excludedGiftName.trim(),
    reason,
  });
  console.log(JSON.stringify({ applied: true, ...result, cutoff: result.cutoff.toISOString() }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());

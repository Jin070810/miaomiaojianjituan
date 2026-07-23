import "dotenv/config";
import { db } from "../lib/db";

const ids = (process.env.ADMIN_KUAISHOU_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
if (ids.length === 0) {
  console.error("请设置 ADMIN_KUAISHOU_IDS（逗号分隔的快手ID）");
  process.exitCode = 1;
} else {
  const result = await db.user.updateMany({ where: { kuaishouId: { in: ids } }, data: { role: "ADMIN" } });
  console.log(`已提升 ${result.count} 个管理员账号`);
}
await db.$disconnect();

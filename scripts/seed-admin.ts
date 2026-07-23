import "dotenv/config";
import { db } from "../lib/db";
import { hashPassword } from "../lib/security";

const ids = (process.env.ADMIN_KUAISHOU_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
async function main() {
  if (ids.length === 0) {
    throw new Error("请设置 ADMIN_KUAISHOU_IDS（逗号分隔的快手ID）");
  }
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (password && (password.length < 8 || password.length > 128)) {
    throw new Error("ADMIN_PASSWORD 长度必须为 8 到 128 位");
  }
  let changed = 0;
  for (const kuaishouId of ids) {
    const passwordHash = password ? await hashPassword(password) : undefined;
    await db.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({ where: { kuaishouId: { equals: kuaishouId, mode: "insensitive" } } });
      if (existing) {
        await tx.user.update({
          where: { id: existing.id },
          data: { role: "ADMIN", active: true, ...(passwordHash ? { passwordHash } : {}) },
        });
        changed += 1;
        return;
      }
      if (!passwordHash) throw new Error(`管理员 ${kuaishouId} 不存在；首次创建必须设置 ADMIN_PASSWORD`);
      const created = await tx.user.create({
        data: {
          kuaishouId,
          nickname: process.env.ADMIN_NICKNAME?.trim() || "管理员",
          passwordHash,
          role: "ADMIN",
          active: true,
          guildStatus: "已入会",
          invited: true,
          account: { create: { balance: 0 } },
        },
      });
      await tx.guildStatusHistory.create({ data: { userId: created.id, status: "已入会", reason: "管理员种子账号" } });
      changed += 1;
    });
  }
  console.log(`已初始化 ${changed} 个管理员账号`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());

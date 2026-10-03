import { db } from "@/lib/db";

export async function preserveTestSettings(keys: string[]) {
  const previous = await db.systemSetting.findMany({ where: { key: { in: keys } } });
  return async () => {
    await db.$transaction(async tx => {
      for (const key of keys) {
        const saved = previous.find(row => row.key === key);
        if (saved) await tx.systemSetting.upsert({ where: { key }, create: saved, update: saved });
        else await tx.systemSetting.deleteMany({ where: { key } });
      }
    });
  };
}

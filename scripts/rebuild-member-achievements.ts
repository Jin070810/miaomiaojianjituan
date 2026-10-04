import "dotenv/config";
import { db } from "../lib/db";
import { getAchievementRefreshStatus } from "../lib/member-achievement-jobs";
import { checkMemberAchievementProjection } from "../lib/member-achievement-reconciliation";

async function main() {
  const args = process.argv.slice(2);
  const modes = args.filter((arg) => ["--status", "--check", "--enqueue"].includes(arg));
  const userIndex = args.indexOf("--user-id");
  const userId = userIndex >= 0 ? args[userIndex + 1] : undefined;
  const all = args.includes("--all");
  const known = new Set(["--status", "--check", "--enqueue", "--all", "--user-id"]);
  if (modes.length > 1 || args.some((arg, index) => !known.has(arg) && !(userIndex >= 0 && index === userIndex + 1)) || (userIndex >= 0 && (!userId || userId.startsWith("--"))) || (all && userIndex >= 0)) {
    throw new Error("Usage: --status | (--check|--enqueue) (--all|--user-id ID)");
  }
  const mode = modes[0] ?? "--status";
  if (mode === "--status") {
    if (all || userId) throw new Error("--status does not accept member selectors");
    console.log(JSON.stringify(await getAchievementRefreshStatus(), null, 2));
    return;
  }
  if (!all && !userId) throw new Error("Select --all or --user-id explicitly");
  let cursor: string | undefined;
  let checked = 0;
  let pending = 0;
  let mismatched = 0;
  do {
    const users = await db.user.findMany({ where: userId ? { id: userId } : undefined,
      select: { id: true }, orderBy: { id: "asc" }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (userId && users.length === 0) throw new Error("Member not found");
    for (const user of users) {
      if (mode === "--enqueue") await db.$queryRaw`SELECT request_member_achievement_refresh(${user.id})::text`;
      else {
        const result = await checkMemberAchievementProjection(user.id);
        if (result.pending) pending += 1;
        if (!result.consistent) { mismatched += 1; console.log(JSON.stringify(result)); }
      }
      checked += 1;
    }
    cursor = users.length === 100 && !userId ? users.at(-1)!.id : undefined;
  } while (cursor);
  console.log(JSON.stringify({ mode, members: checked, pending, mismatched }));
  if (mode === "--check" && mismatched > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Achievement maintenance failed");
  process.exitCode = 1;
}).finally(() => db.$disconnect());

import "dotenv/config";
import path from "node:path";
import { downloadLatestBackup } from "../lib/oss-backup";
import { sendOperationalAlert } from "../lib/alerts";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

async function main() {
  const output = argument("output");
  if (!output) throw new Error("用法：npm run ops:download-backup -- --output <目录>");
  const result = await downloadLatestBackup(path.resolve(output));
  console.log(JSON.stringify(result, null, 2));
}

main().catch(async (error) => {
  await sendOperationalAlert({
    source: "backup-restore-drill",
    severity: "critical",
    message: "OSS 备份恢复下载或校验失败",
    details: { error: error instanceof Error ? error.message : "unknown" },
  });
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import "dotenv/config";
import path from "node:path";
import { uploadAndVerifyBackup } from "../lib/oss-backup";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

async function main() {
  const file = argument("file");
  if (!file) throw new Error("用法：npm run ops:upload-backup -- --file <备份文件>");
  const result = await uploadAndVerifyBackup(path.resolve(file));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import "dotenv/config";
import { sendOperationalAlert } from "../lib/alerts";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

async function main() {
  const source = argument("source") ?? "operations-workflow";
  const message = argument("message") ?? "生产运维工作流失败";
  const severity = argument("severity") ?? "critical";
  if (!/^[a-z0-9-]{1,64}$/i.test(source)) throw new Error("告警来源格式无效");
  if (!message || message.length > 200) throw new Error("告警消息格式无效");
  if (!(["info", "warning", "critical"] as const).includes(severity as "info" | "warning" | "critical")) {
    throw new Error("告警级别无效");
  }
  const result = await sendOperationalAlert({
    source,
    severity: severity as "info" | "warning" | "critical",
    message,
  });
  if (!result.sent) throw new Error(`告警发送失败：${result.reason}`);
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

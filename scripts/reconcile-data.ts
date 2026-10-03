import "dotenv/config";
import { db } from "../lib/db";
import { inspectFinancialIntegrity } from "../lib/integrity-reconciliation";

async function main() {
  const result = await inspectFinancialIntegrity();
  const report = {
    generatedAt: new Date().toISOString(),
    ...result,
    warnings: result.compensatingDebts.length ? [`${result.compensatingDebts.length} 个账户存在有来源证据的补偿性欠额，需业务跟进`] : [],
  };
  console.log(JSON.stringify(report, null, 2));
  if (result.hasErrors) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());

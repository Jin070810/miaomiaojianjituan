import { db } from "./db";
export async function getDatabasePressure() {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '750ms'");
      const [row] = await tx.$queryRaw<Array<{ active: number; lockWaiting: number; longTransactions: number; oldestTransactionSeconds: number | null }>>`
        SELECT count(*) FILTER (WHERE state = 'active')::int AS "active",
          count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS "lockWaiting",
          count(*) FILTER (WHERE xact_start < clock_timestamp() - interval '60 seconds')::int AS "longTransactions",
          max(extract(epoch from clock_timestamp() - xact_start))::float8 AS "oldestTransactionSeconds"
        FROM pg_stat_activity
        WHERE datname = current_database() AND usename = current_user AND pid <> pg_backend_pid()
      `;
      return { at: new Date().toISOString(), ...row };
    }, { maxWait: 500, timeout: 1500 });
  } catch { return null; }
}

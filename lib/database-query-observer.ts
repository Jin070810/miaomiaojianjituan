import { recordPerformance } from "./performance-store";
export function databaseMetricKey(query: string) {
  const operation = query.trimStart().slice(0, 12).toUpperCase().split(/\s/)[0];
  if (operation === "SELECT") return "db_read";
  if (["INSERT", "UPDATE", "DELETE"].includes(operation)) return "db_write";
  if (["BEGIN", "COMMIT", "ROLLBACK"].includes(operation)) return null;
  return "db_other";
}
// Never export or log SQL/parameters. Uniform sampling, not slow-only sampling.
export function observeDatabaseQuery(event: { query: string; duration: number }) {
  const key = databaseMetricKey(event.query);
  if (key && Math.random() < 0.1) void recordPerformance(key, event.duration);
}

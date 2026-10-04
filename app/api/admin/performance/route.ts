import { currentUser } from "@/lib/auth";
import { getPerformanceSnapshot } from "@/lib/performance-store";
import { getDatabasePressure } from "@/lib/database-performance";
export const dynamic = "force-dynamic";
export async function GET() {
  const user = await currentUser();
  if (!user || user.role !== "ADMIN") return Response.json({ error: "无权访问" }, { status: 403, headers: { "cache-control": "no-store" } });
  const [metrics, database] = await Promise.all([getPerformanceSnapshot(), getDatabasePressure()]);
  return Response.json({ ...metrics, database }, { headers: { "cache-control": "no-store" } });
}

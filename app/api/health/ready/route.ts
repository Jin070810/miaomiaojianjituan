import { NextResponse } from "next/server";
import { getWebReadiness } from "@/lib/health-readiness";
import { healthHeaders } from "@/lib/health-probe";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getWebReadiness();
  return NextResponse.json(health, { status: health.ok ? 200 : 503, headers: healthHeaders });
}

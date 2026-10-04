import { NextResponse } from "next/server";
import { healthAppVersion, healthHeaders } from "@/lib/health-probe";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, app: healthAppVersion(), time: new Date().toISOString() }, { headers: healthHeaders });
}

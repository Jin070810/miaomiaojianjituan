import { NextResponse } from "next/server";
import { RegistrationApplicationStatus } from "@prisma/client";
import { requireRegistrationApprover } from "@/lib/auth";
import { listRegistrationApplications, registrationApplicationStatuses } from "@/lib/registration";

export async function GET(request: Request) {
  try {
    await requireRegistrationApprover();
    const requested = new URL(request.url).searchParams.get("status");
    const status = registrationApplicationStatuses.includes(requested as typeof registrationApplicationStatuses[number]) ? requested as RegistrationApplicationStatus : "PENDING";
    return NextResponse.json({ applications: await listRegistrationApplications(status) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

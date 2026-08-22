import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, rateLimitResponse } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getRegistrationApplicationStatus } from "@/lib/registration";

const querySchema = z.object({ applicationId: z.string().trim().min(1), queryToken: z.string().trim().min(20) });

export async function GET(request: Request) {
  try {
    await enforceRateLimit(`registration-status:${getClientIp(request)}`, 30, 3600);
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const result = await getRegistrationApplicationStatus(input);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof z.ZodError ? "查询参数不正确" : error instanceof Error ? error.message : "查询失败" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireRegistrationApprover } from "@/lib/auth";
import { assertSameOrigin, getClientIp, requestId } from "@/lib/security";
import { reviewRegistrationApplication } from "@/lib/registration";

const schema = z.object({ action: z.enum(["APPROVE", "REJECT"]), reason: z.string().trim().max(300).optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const reviewer = await requireRegistrationApprover();
    const input = schema.parse(await request.json());
    const { id } = await context.params;
    const result = await reviewRegistrationApplication({ applicationId: id, ...input, reviewer: { id: reviewer.id, role: reviewer.role }, ip: getClientIp(request), requestId: requestId() });
    return NextResponse.json({ application: result });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? 409 : error instanceof Error && error.message.includes("无权") ? 403 : 400;
    return NextResponse.json({ error: error instanceof z.ZodError ? "审核参数不正确" : error instanceof Error ? error.message : "审核失败" }, { status });
  }
}

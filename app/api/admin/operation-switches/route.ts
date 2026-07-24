import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import {
  getOperationSwitches,
  operationSwitchDefinitions,
  updateOperationSwitch,
} from "@/lib/operation-switches";
import { assertSameOrigin, getClientIp, requestId } from "@/lib/security";

const schema = z.object({
  key: z.enum(Object.keys(operationSwitchDefinitions) as [
    keyof typeof operationSwitchDefinitions,
    ...(keyof typeof operationSwitchDefinitions)[],
  ]),
  enabled: z.boolean(),
});

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ switches: await getOperationSwitches() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const input = schema.parse(await request.json());
    await updateOperationSwitch({
      ...input,
      actorId: admin.id,
      ip: getClientIp(request),
      requestId: requestId(),
    });
    return NextResponse.json({ switches: await getOperationSwitches() });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof z.ZodError ? "运营开关参数不正确" : error instanceof Error ? error.message : "运营开关更新失败",
    }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin, getClientIp, requestId } from "@/lib/security";
import { createRegistrationInviteLink, getRegistrationInviteLink } from "@/lib/registration";

const schema = z.object({ expiresAt: z.string().datetime().optional().nullable() });

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ link: await getRegistrationInviteLink() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const input = schema.parse(await request.json().catch(() => ({})));
    const created = await createRegistrationInviteLink({ actorId: admin.id, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, ip: getClientIp(request), requestId: requestId() });
    const url = new URL(`/join/${created.token}`, request.url);
    return NextResponse.json({ link: { ...created.link, token: undefined, url: url.toString() } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "链接参数不正确" : error instanceof Error ? error.message : "链接生成失败" }, { status: 400 });
  }
}

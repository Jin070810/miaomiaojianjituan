import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { publishAnnouncement, updateAnnouncementDraft, withdrawAnnouncement } from "@/lib/notifications";
import { assertSameOrigin, getClientIp } from "@/lib/security";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    title: z.string().trim().min(1).max(80),
    content: z.string().trim().min(1).max(5000),
    audience: z.enum(["ALL", "SELECTED"]),
    recipientIds: z.array(z.string().min(1)).max(200).optional(),
  }),
  z.object({ action: z.literal("publish") }),
  z.object({ action: z.literal("withdraw") }),
]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const common = { announcementId: id, actorId: admin.id, ip: getClientIp(request) };
    if (input.action === "publish") {
      return NextResponse.json({ announcement: await publishAnnouncement(common) });
    }
    if (input.action === "withdraw") {
      return NextResponse.json({ announcement: await withdrawAnnouncement(common) });
    }
    if (input.audience === "SELECTED" && !input.recipientIds?.length) {
      return NextResponse.json({ error: "定向公告至少选择一名成员" }, { status: 400 });
    }
    return NextResponse.json({
      announcement: await updateAnnouncementDraft({ ...common, ...input }),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "公告操作参数不正确" : error instanceof Error ? error.message : "公告操作失败" }, { status: 400 });
  }
}

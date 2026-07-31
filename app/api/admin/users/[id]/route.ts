import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, getClientIp } from "@/lib/security";
import { syncEligibilityAfterRoleChange } from "@/lib/member-clearance";

const schema = z.object({
  active: z.boolean().optional(),
  role: z.enum(["MEMBER", "REVIEWER", "ADMIN"]).optional(),
  guildStatus: z.string().trim().max(30).nullable().optional(),
  invited: z.boolean().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const before = await db.user.findUnique({ where: { id }, include: { eligibility: true } });
    if (!before) return NextResponse.json({ error: "成员不存在" }, { status: 404 });
    if (before.id === admin.id && input.active === false) return NextResponse.json({ error: "不能停用当前管理员账号" }, { status: 400 });
    if (before.id === admin.id && input.role !== undefined && input.role !== "ADMIN") return NextResponse.json({ error: "不能移除当前管理员自己的权限" }, { status: 400 });
    if (input.active === true && !before.active && before.eligibility && ["COOLDOWN", "REJOIN_PENDING", "REJOIN_REJECTED"].includes(before.eligibility.status)) {
      return NextResponse.json({ error: "已清退成员必须通过重新加入审核恢复" }, { status: 400 });
    }
    if (before.role === "ADMIN" && input.role !== undefined && input.role !== "ADMIN") {
      const activeAdmins = await db.user.count({ where: { role: "ADMIN", active: true } });
      if (activeAdmins <= 1) return NextResponse.json({ error: "系统必须至少保留一个启用的管理员" }, { status: 400 });
    }
    const updated = await db.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          ...input,
          ...(input.guildStatus !== undefined && input.guildStatus === "已邀请" ? { invited: true } : {}),
          ...(input.guildStatus !== undefined && input.guildStatus === "已入会" ? { invited: true } : {}),
          ...(input.guildStatus !== undefined && input.guildStatus === "未绑定" ? { invited: false } : {}),
        },
      });
      if (input.guildStatus !== undefined && input.guildStatus !== before.guildStatus) {
        await tx.guildStatusHistory.create({ data: { userId: id, status: input.guildStatus ?? "未设置", reason: "管理员更新" } });
      }
      await syncEligibilityAfterRoleChange(tx, user);
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "USER_UPDATED",
          entity: "User",
          entityId: id,
          beforeValue: { active: before.active, role: before.role, guildStatus: before.guildStatus, invited: before.invited },
          afterValue: input,
          ip: getClientIp(request),
        },
      });
      return user;
    });
    const { passwordHash, boundPhoneEnc, ...safe } = updated;
    return NextResponse.json({ user: safe });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "成员参数不正确" : error instanceof Error ? error.message : "更新失败" }, { status: 400 });
  }
}

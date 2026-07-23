import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { AVATAR_SIZE, compressAvatar, MAX_AVATAR_UPLOAD_BYTES } from "@/lib/avatar";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin, getClientIp, rateLimitResponse } from "@/lib/security";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function saveAvatar(request: Request, userId: string) {
  const form = await request.formData();
  const entry = form.get("avatar");
  if (!(entry instanceof File)) throw new Error("请选择头像图片");
  if (!ALLOWED_TYPES.has(entry.type)) throw new Error("头像仅支持 JPG、PNG 或 WebP 图片");
  if (entry.size <= 0 || entry.size > MAX_AVATAR_UPLOAD_BYTES) throw new Error("头像图片不能超过 5MB");

  const input = Buffer.from(await entry.arrayBuffer());
  const output = await compressAvatar(input);

  const avatarUrl = `data:image/webp;base64,${output.toString("base64")}`;
  const updated = await db.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });
    const saved = await tx.user.update({ where: { id: userId }, data: { avatarUrl } });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: "AVATAR_UPDATED",
        entity: "User",
        entityId: userId,
        beforeValue: { hasAvatar: Boolean(before?.avatarUrl) },
        afterValue: { hasAvatar: true, bytes: output.length, format: "webp", width: AVATAR_SIZE, height: AVATAR_SIZE },
        ip: getClientIp(request),
      },
    });
    return saved;
  });
  return { avatarUrl: updated.avatarUrl };
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await enforceRateLimit(`avatar-update:${user.id}`, 10, 3600);
    return NextResponse.json({ user: await saveAvatar(request, user.id) });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof Error ? error.message : "头像上传失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await enforceRateLimit(`avatar-update:${user.id}`, 10, 3600);
    await db.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id: user.id }, select: { avatarUrl: true } });
      await tx.user.update({ where: { id: user.id }, data: { avatarUrl: null } });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "AVATAR_RESET",
          entity: "User",
          entityId: user.id,
          beforeValue: { hasAvatar: Boolean(before?.avatarUrl) },
          afterValue: { hasAvatar: false },
          ip: getClientIp(request),
        },
      });
    });
    return NextResponse.json({ avatarUrl: null });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof Error ? error.message : "恢复默认头像失败" }, { status: 400 });
  }
}

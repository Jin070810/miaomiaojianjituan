import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, decryptSensitive, encryptSensitive, getClientIp, isSafeCashQrCodeUrl, MAX_CASH_QR_CODE_LENGTH, rateLimitResponse } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  recipientName: z.string().trim().max(80).nullable().optional(),
  phone: z.string().trim().regex(/^1\d{10}$/).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  cashQrCodeUrl: z.string().trim().max(MAX_CASH_QR_CODE_LENGTH).refine(isSafeCashQrCodeUrl, "收款码必须是 HTTPS 图片地址或 PNG、JPG、WebP 图片").nullable().optional(),
});

function safeProfile(profile: { recipientName: string | null; phoneEnc: string | null; addressEnc: string | null; cashQrCodeUrl: string | null } | null) {
  return {
    recipientName: profile?.recipientName ?? null,
    phone: profile?.phoneEnc ? decryptSensitive(profile.phoneEnc) : null,
    address: profile?.addressEnc ? decryptSensitive(profile.addressEnc) : null,
    cashQrCodeUrl: profile?.cashQrCodeUrl ?? null,
  };
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const profile = await db.recipientProfile.findUnique({ where: { userId: user.id } });
  return NextResponse.json({ profile: safeProfile(profile) });
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await enforceRateLimit(`recipient-profile:${user.id}`, 10, 600);
    const input = schema.parse(await request.json());
    const profile = await db.$transaction(async (tx) => {
      const saved = await tx.recipientProfile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          recipientName: input.recipientName ?? null,
          phoneEnc: input.phone ? encryptSensitive(input.phone) : null,
          addressEnc: input.address ? encryptSensitive(input.address) : null,
          cashQrCodeUrl: input.cashQrCodeUrl ?? null,
        },
        update: {
          ...(input.recipientName !== undefined ? { recipientName: input.recipientName } : {}),
          ...(input.phone !== undefined ? { phoneEnc: input.phone ? encryptSensitive(input.phone) : null } : {}),
          ...(input.address !== undefined ? { addressEnc: input.address ? encryptSensitive(input.address) : null } : {}),
          ...(input.cashQrCodeUrl !== undefined ? { cashQrCodeUrl: input.cashQrCodeUrl } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "RECIPIENT_PROFILE_UPDATED",
          entity: "RecipientProfile",
          entityId: saved.id,
          afterValue: {
            hasName: Boolean(saved.recipientName),
            hasPhone: Boolean(saved.phoneEnc),
            hasAddress: Boolean(saved.addressEnc),
            hasCashQrCode: Boolean(saved.cashQrCodeUrl),
          },
          ip: getClientIp(request),
        },
      });
      return saved;
    });
    return NextResponse.json({ profile: safeProfile(profile) });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof z.ZodError ? "收货信息格式不正确" : error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}

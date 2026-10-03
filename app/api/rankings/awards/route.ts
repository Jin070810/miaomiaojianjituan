import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { withPublicGiftImage } from "@/lib/public-images";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { db } = await import("@/lib/db");
  const awards = await db.rankingAward.findMany({
    where: { userId: user.id },
    include: { gift: { select: { id: true, name: true, kind: true, imageUrl: true } }, period: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({
    awards: awards.map(({ recipientPhoneEnc, recipientAddressEnc, cashQrCodeUrl, ...award }) => ({
      ...award,
      gift: award.gift ? withPublicGiftImage(award.gift) : null,
      hasRecipientPhone: Boolean(recipientPhoneEnc),
      hasRecipientAddress: Boolean(recipientAddressEnc),
      hasCashQrCode: Boolean(cashQrCodeUrl),
    })),
  });
}

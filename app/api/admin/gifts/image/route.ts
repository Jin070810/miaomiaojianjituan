import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { compressGiftImage, MAX_GIFT_IMAGE_DIMENSION, MAX_GIFT_IMAGE_UPLOAD_BYTES } from "@/lib/gift-image";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin, rateLimitResponse } from "@/lib/security";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    await enforceRateLimit(`gift-image-upload:${admin.id}`, 30, 3600);
    const form = await request.formData();
    const entry = form.get("image");
    if (!(entry instanceof File)) throw new Error("请选择礼品图片");
    if (!ALLOWED_TYPES.has(entry.type)) throw new Error("礼品图片仅支持 JPG、PNG 或 WebP");
    if (entry.size <= 0 || entry.size > MAX_GIFT_IMAGE_UPLOAD_BYTES) throw new Error("礼品图片不能超过 5MB");

    const output = await compressGiftImage(Buffer.from(await entry.arrayBuffer()));
    return NextResponse.json({
      imageUrl: `data:image/webp;base64,${output.toString("base64")}`,
      image: { format: "webp", maxDimension: MAX_GIFT_IMAGE_DIMENSION, bytes: output.length },
    });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof Error ? error.message : "礼品图片上传失败" }, { status: 400 });
  }
}

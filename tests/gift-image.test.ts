import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { compressGiftImage, MAX_GIFT_IMAGE_DIMENSION, MAX_GIFT_IMAGE_OUTPUT_BYTES } from "@/lib/gift-image";

describe("gift image compression", () => {
  it("normalizes uploads to a bounded WebP image", async () => {
    const input = await sharp({
      create: {
        width: 2400,
        height: 1600,
        channels: 3,
        background: { r: 38, g: 158, b: 129 },
      },
    }).png().toBuffer();

    const output = await compressGiftImage(input);
    const metadata = await sharp(output).metadata();
    expect(metadata.format).toBe("webp");
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(MAX_GIFT_IMAGE_DIMENSION);
    expect(output.length).toBeLessThan(MAX_GIFT_IMAGE_OUTPUT_BYTES);
  });

  it("rejects invalid image bytes", async () => {
    await expect(compressGiftImage(Buffer.from("not-an-image"))).rejects.toThrow();
  });
});

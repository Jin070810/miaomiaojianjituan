import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { AVATAR_SIZE, compressAvatar, MAX_AVATAR_OUTPUT_BYTES } from "@/lib/avatar";

describe("avatar compression", () => {
  it("crops an uploaded image to a small square WebP", async () => {
    const input = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: { r: 255, g: 90, b: 61 },
      },
    }).png().toBuffer();

    const output = await compressAvatar(input);
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(AVATAR_SIZE);
    expect(metadata.height).toBe(AVATAR_SIZE);
    expect(output.length).toBeLessThan(MAX_AVATAR_OUTPUT_BYTES);
  });

  it("rejects data that is not a valid image", async () => {
    await expect(compressAvatar(Buffer.from("not-an-image"))).rejects.toThrow();
  });
});

import sharp from "sharp";

export const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_AVATAR_OUTPUT_BYTES = 120 * 1024;
export const AVATAR_SIZE = 256;
const MAX_DIMENSION = 6000;

export async function compressAvatar(input: Buffer) {
  const image = sharp(input, { limitInputPixels: 25_000_000, failOn: "error" });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
    throw new Error("头像尺寸过大，请上传 6000×6000 以内的图片");
  }

  const output = await image
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
    .webp({ quality: 82, effort: 5 })
    .toBuffer();
  if (output.length > MAX_AVATAR_OUTPUT_BYTES) throw new Error("头像压缩后仍然过大，请换一张图片");
  return output;
}

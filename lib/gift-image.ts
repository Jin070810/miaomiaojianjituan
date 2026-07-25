import sharp from "sharp";

export const MAX_GIFT_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_GIFT_IMAGE_OUTPUT_BYTES = 120 * 1024;
export const MAX_GIFT_IMAGE_DIMENSION = 800;
const MAX_INPUT_DIMENSION = 8000;

async function render(input: Buffer, dimension: number, quality: number) {
  return sharp(input, { limitInputPixels: 36_000_000, failOn: "error" })
    .rotate()
    .resize(dimension, dimension, { fit: "inside", withoutEnlargement: true })
    .webp({ quality, effort: 5 })
    .toBuffer();
}

export async function compressGiftImage(input: Buffer) {
  const metadata = await sharp(input, { limitInputPixels: 36_000_000, failOn: "error" }).metadata();
  if (!metadata.width || !metadata.height || metadata.width > MAX_INPUT_DIMENSION || metadata.height > MAX_INPUT_DIMENSION) {
    throw new Error("礼品图片尺寸过大，请上传 8000×8000 以内的图片");
  }

  let output = await render(input, MAX_GIFT_IMAGE_DIMENSION, 80);
  if (output.length > MAX_GIFT_IMAGE_OUTPUT_BYTES) output = await render(input, 640, 68);
  if (output.length > MAX_GIFT_IMAGE_OUTPUT_BYTES) throw new Error("礼品图片压缩后仍然过大，请换一张图片");
  return output;
}

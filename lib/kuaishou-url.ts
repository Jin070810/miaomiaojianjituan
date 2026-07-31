const PHOTO_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Builds the stable public URL for the video that was actually fetched and
 * reviewed. Never use the submitted short/share URL for history links: it can
 * redirect somewhere else after the submission has been processed.
 */
export function canonicalKuaishouVideoUrl(photoId: string | null | undefined) {
  const normalizedPhotoId = photoId?.trim();
  if (!normalizedPhotoId || !PHOTO_ID_PATTERN.test(normalizedPhotoId)) return null;
  return `https://www.kuaishou.com/short-video/${normalizedPhotoId}`;
}

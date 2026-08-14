import { normalizeDouyinLink } from "./douyin";
import { normalizeKuaishouLink } from "./kuaishou";

export function normalizeVideoLink(input: string) {
  if (/https?:\/\/[^\s]*douyin\.com\//i.test(input)) return normalizeDouyinLink(input);
  return normalizeKuaishouLink(input);
}

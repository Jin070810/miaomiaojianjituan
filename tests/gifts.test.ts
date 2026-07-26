import { describe, expect, it } from "vitest";
import { giftImageValueSchema, inferGiftKind, isGiftImageSource } from "@/lib/gifts";

describe("gift kind inference", () => {
  it("classifies migrated cash rewards", () => {
    expect(inferGiftKind("5元现金")).toBe("CASH");
    expect(inferGiftKind("50 元现金红包")).toBe("CASH");
  });

  it("keeps merchandise as physical rewards", () => {
    expect(inferGiftKind("原创设计浅蓝色手链")).toBe("PHYSICAL");
  });
});

describe("gift image validation", () => {
  it("accepts existing relative paths, web URLs, and uploaded WebP values", () => {
    expect(isGiftImageSource("/gift-images/example.webp")).toBe(true);
    expect(isGiftImageSource("https://cdn.example.com/gift.jpg")).toBe(true);
    expect(giftImageValueSchema.parse("data:image/webp;base64,UklGRg==")).toContain("data:image/webp");
  });

  it("rejects unsafe or unsupported image sources", () => {
    expect(isGiftImageSource("javascript:alert(1)")).toBe(false);
    expect(isGiftImageSource("/gift-images/../secret")).toBe(false);
    expect(isGiftImageSource("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
  });
});

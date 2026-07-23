import { describe, expect, it } from "vitest";
import { inferGiftKind } from "@/lib/gifts";

describe("gift kind inference", () => {
  it("classifies migrated cash rewards", () => {
    expect(inferGiftKind("5元现金")).toBe("CASH");
    expect(inferGiftKind("50 元现金红包")).toBe("CASH");
  });

  it("keeps merchandise as physical rewards", () => {
    expect(inferGiftKind("原创设计浅蓝色手链")).toBe("PHYSICAL");
  });
});

import { describe, expect, it } from "vitest";
import { parseWorkbenchRange } from "@/lib/admin-workbench";

describe("admin workbench query parsing", () => {
  it("accepts supported ranges and defaults invalid input to the narrow operational window", () => {
    expect(parseWorkbenchRange("7d")).toBe("7d");
    expect(parseWorkbenchRange("30d")).toBe("30d");
    expect(parseWorkbenchRange("365d")).toBe("7d");
    expect(parseWorkbenchRange(null)).toBe("7d");
  });
});

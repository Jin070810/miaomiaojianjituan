import { describe, expect, it } from "vitest";
import { csvCell, maskedIp, toCsv } from "@/lib/csv";

describe("脱敏 CSV", () => {
  it("escapes formulas and quotes", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(toCsv(["名称"], [["普通,值"]])).toContain("\"普通,值\"");
  });

  it("keeps numeric values numeric-looking, including negative points", () => {
    expect(csvCell(-680)).toBe("\"-680\"");
  });

  it("masks IPv4 and IPv6 addresses", () => {
    expect(maskedIp("192.168.1.10")).toBe("192.168.***.***");
    expect(maskedIp("2001:db8:abcd::1")).toBe("2001:db8:****");
  });
});

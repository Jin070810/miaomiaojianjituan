import { describe, expect, it } from "vitest";
import { assertSameOrigin, getClientIp } from "../lib/security";

describe("proxy-aware request security", () => {
  it("accepts the public HTTPS origin behind the Nginx HTTP proxy", () => {
    const request = new Request("http://app:3000/api/videos", {
      headers: {
        origin: "https://miaoyi.site",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "miaoyi.site",
      },
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("rejects a cross-site origin behind the proxy", () => {
    const request = new Request("http://app:3000/api/videos", {
      headers: {
        origin: "https://evil.example",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "miaoyi.site",
      },
    });
    expect(() => assertSameOrigin(request)).toThrow("跨站请求已拒绝");
  });

  it("uses the proxy-set real IP instead of a spoofable forwarded prefix", () => {
    const request = new Request("https://miaoyi.site/api/auth/login", {
      headers: {
        "x-real-ip": "203.0.113.9",
        "x-forwarded-for": "198.51.100.7, 203.0.113.9",
      },
    });
    expect(getClientIp(request)).toBe("203.0.113.9");
  });
});

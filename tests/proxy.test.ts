import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

const navigationCacheControl = "private, no-cache, no-store, max-age=0, must-revalidate";

describe("navigation proxy", () => {
  it("sends a visitor without a session directly to login", () => {
    const response = proxy(new NextRequest("https://miaoyi.site/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://miaoyi.site/login");
    expect(response.headers.get("cache-control")).toBe(navigationCacheControl);
  });

  it("keeps a session-bearing root request in the member app", () => {
    const response = proxy(new NextRequest("https://miaoyi.site/", {
      headers: { cookie: "miaomiao_session=active-session" },
    }));

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe(navigationCacheControl);
  });

  it("keeps the login document revalidating", () => {
    const response = proxy(new NextRequest("https://miaoyi.site/login"));

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe(navigationCacheControl);
  });
});

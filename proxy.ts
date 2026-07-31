import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "miaomiao_session";
const NAVIGATION_CACHE_CONTROL = "private, no-cache, no-store, max-age=0, must-revalidate";

export function proxy(request: NextRequest) {
  const response = request.nextUrl.pathname === "/" && !request.cookies.has(SESSION_COOKIE)
    ? NextResponse.redirect(new URL("/login", request.url))
    : NextResponse.next();

  // WebView caches can retain an old HTML shell after a release while the
  // referenced JavaScript chunks have already changed. Keep navigation pages
  // revalidating, but leave versioned /_next assets on their immutable cache.
  response.headers.set("Cache-Control", NAVIGATION_CACHE_CONTROL);
  return response;
}

export const config = {
  matcher: ["/", "/login"],
};

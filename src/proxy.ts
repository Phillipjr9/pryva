import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  // Security headers
  response.headers.set("X-DNS-Prefetch-Control", "on");
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  // The isolated in-memory preview must be embeddable in the Arena viewer.
  // Keep clickjacking protection for real databases and non-preview hosts.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const embeddedPreview = !process.env.DATABASE_URL?.trim() && /(?:^|\.)e2b\.app(?::\d+)?$/i.test(host);
  if (!embeddedPreview) response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // Never make privileged responses publicly cacheable or cross-origin readable.
  if (request.nextUrl.pathname.startsWith("/api/admin/")) {
    response.headers.set("Cache-Control", "no-store");
  } else if (request.nextUrl.pathname.startsWith("/api/")) {
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|images|manifest.json|sw.js).*)",
  ],
};

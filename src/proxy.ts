import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  CONTENT_SECURITY_POLICY_HEADER,
  contentSecurityPolicy,
  isEmbeddedPreviewHost,
} from "@/lib/platform/security-headers";
import { FRAMEWORK_BANNERS } from "@/lib/platform/server-banner";

/** The live environment, deliberately not the build-time-inlined spelling. */
const runtimeEnv: Record<string, string | undefined> = process.env;

export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  // Security headers
  response.headers.set("X-DNS-Prefetch-Control", "on");
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  // The isolated in-memory preview must be embeddable in the Arena viewer.
  // Keep clickjacking protection for real databases and non-preview hosts.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const embeddedPreview = !process.env.DATABASE_URL?.trim() && isEmbeddedPreviewHost(host);
  if (!embeddedPreview) response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set(
    CONTENT_SECURITY_POLICY_HEADER,
    contentSecurityPolicy({
      embeddedPreview,
      development: process.env.NODE_ENV !== "production",
      // Matches what the signup page renders: no key, no widget, no origin
      // opened. Read through a variable rather than `process.env.NEXT_PUBLIC_…`
      // directly, because Next inlines that spelling at build time — a build-time
      // CSP and a runtime widget could disagree, and a disagreement blocks the
      // challenge for every visitor. Reading the env here rather than importing
      // the Turnstile module also keeps this file free of server-only imports.
      turnstile: Boolean(runtimeEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()),
    }),
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // No banner, no version. `poweredByHeader: false` in next.config.ts is what
  // stops Next adding `X-Powered-By`; this removes the rest (and covers a
  // middleware short-circuit, whose response is built here rather than by a
  // route). `Server` is platform-written after this runs, so it is documented
  // rather than claimed: `scripts/check-headers.mjs` reports what actually goes
  // out, including the one header the app cannot reach.
  for (const banner of [...FRAMEWORK_BANNERS, "server"]) {
    response.headers.delete(banner);
  }

  // API responses are per-user and must never be cached by a proxy or CDN.
  // No CORS headers are set on purpose: every caller is the app itself, so a
  // wildcard `Access-Control-Allow-Origin` only served to make authenticated
  // reads reachable from other origins if a browser ever sent credentials.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    response.headers.set("Cache-Control", "no-store");
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|images|manifest.json|sw.js).*)",
  ],
};

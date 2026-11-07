import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  CONTENT_SECURITY_POLICY_HEADER,
  contentSecurityPolicy,
  isEmbeddedPreviewHost,
} from "@/lib/platform/security-headers";
import { FRAMEWORK_BANNERS } from "@/lib/platform/server-banner";
import {
  SESSION_TOKENS_HEADER,
  sessionCookieCopies,
  sessionTokensForHeader,
} from "@/lib/platform/session-cookies";

/** The live environment, deliberately not the build-time-inlined spelling. */
const runtimeEnv: Record<string, string | undefined> = process.env;

export function proxy(request: NextRequest) {
  /*
   * Hand the pathname to the app.
   *
   * A layout cannot ask which child route is rendering, and one does need to
   * know: the console layout gates everything under `/admin`, including
   * `/admin/account`, which is the page an operator without a second factor is
   * redirected to. Without the path it can only gate that page too, and the
   * redirect loops on itself.
   *
   * `NextResponse.next({ request: { headers } })` is the documented way to add a
   * request header (not `{ headers }`, which would send it to the client instead).
   * The value comes from `nextUrl.pathname`, so a client cannot forge it: a
   * caller-supplied copy is overwritten here on every request.
   */
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pryva-pathname", request.nextUrl.pathname);

  /*
   * A browser can hold two cookies called `pryva_session` — a host-only one from
   * before the site moved to its own domain, and one written with
   * `Domain=pryvalogs.com` afterwards. Next keeps only one of them, and when it
   * keeps the dead copy the visitor is signed in and treated as signed out.
   * `lib/platform/session-cookies` explains the failure and the repair; all that
   * happens here is handing the app every copy, because this is the last place
   * both are still visible.
   *
   * The header is overwritten from the parsed `Cookie` header on every request,
   * never read from the caller, so it cannot be forged: a client that sends one
   * has it replaced here, and a request with no session cookie has it removed.
   */
  const copies = sessionCookieCopies(request.headers.get("cookie"));
  if (copies.length) {
    requestHeaders.set(SESSION_TOKENS_HEADER, sessionTokensForHeader(copies));
  } else {
    requestHeaders.delete(SESSION_TOKENS_HEADER);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });

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

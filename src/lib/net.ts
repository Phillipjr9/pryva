/**
 * Request URL helpers for proxied environments.
 *
 * Inside hosting sandboxes the app binds to an internal host (0.0.0.0:3000)
 * behind a TLS-terminating gateway. Forwarded headers tell us what the
 * browser actually sees — and without them, a non-local host implies HTTPS.
 */

function isLocalHost(host: string): boolean {
  return (
    host.startsWith("localhost") ||
    host.startsWith("127.") ||
    host.startsWith("[::1") ||
    host.startsWith("0.0.0.0") ||
    host.endsWith(".local") ||
    host.includes(":")
  );
}

export function requestProto(request: Request): "https" | "http" {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.startsWith("https") ? "https" : "http";

  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  if (host) return isLocalHost(host) ? "http" : "https";

  try {
    return new URL(request.url).protocol === "https:" ? "https" : "http";
  } catch {
    return process.env.NODE_ENV === "production" ? "https" : "http";
  }
}

export function publicOrigin(request: Request): string {
  // Site owners can pin the public origin explicitly (needed for OAuth
  // redirect URIs when the gateway doesn't forward protocol headers).
  const pinned = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (pinned) return pinned.replace(/\/+$/, "");

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) return `${requestProto(request)}://${host}`;
  try {
    return new URL(request.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}

/** A relative redirect — bulletproof across proxies, http(s) and host rewrites. */
export function relativeRedirect(path: string, status = 303): Response {
  return new Response(null, { status, headers: { Location: path } });
}

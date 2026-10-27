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

/** Reject cross-origin browser mutations, including iframe-originated requests. */
export function isSameOriginMutation(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true;

  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true; // Non-browser clients do not necessarily send Origin.

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    const expectedOrigin = host
      ? new URL(`${requestProto(request)}://${host}`).origin
      : new URL(request.url).origin;
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}

/** A relative redirect — bulletproof across proxies, http(s) and host rewrites. */
export function relativeRedirect(path: string, status = 303): Response {
  return new Response(null, { status, headers: { Location: path } });
}

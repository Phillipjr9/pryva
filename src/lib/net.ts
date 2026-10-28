/**
 * Request URL helpers for proxied environments.
 *
 * Inside hosting sandboxes the app binds to an internal host (0.0.0.0:3000)
 * behind a TLS-terminating gateway. Forwarded headers tell us what the
 * browser actually sees — and without them, a non-local host implies HTTPS.
 */

export function isLocalHost(host: string): boolean {
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase();
    return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "[::1]" ||
      hostname === "0.0.0.0" || /^127(?:\.\d{1,3}){3}$/.test(hostname) || hostname.endsWith(".local");
  } catch {
    return false;
  }
}

/** The Arena preview gateway serves this sandbox's port hosts over HTTPS. */
export function isArenaPreviewHost(host: string): boolean {
  const sandboxId = process.env.E2B_SANDBOX_ID?.trim().toLowerCase();
  // Never use this preview-specific exception for a persistent deployment, an
  // unknown sandbox, or a different sandbox's host.
  if (process.env.DATABASE_URL?.trim() || !sandboxId || !/^[a-z0-9]+$/.test(sandboxId)) return false;
  try {
    const url = new URL(`https://${host}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return false;
    const suffix = `-${sandboxId}.e2b.app`;
    const hostname = url.hostname.toLowerCase();
    if (!hostname.endsWith(suffix)) return false;
    const port = hostname.slice(0, -suffix.length);
    return /^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) <= 65535;
  } catch {
    return false;
  }
}

export function requestProto(request: Request): "https" | "http" {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  // The Arena gateway terminates HTTPS, but its internal hop can overwrite
  // X-Forwarded-Proto with "http". Only correct that for this in-memory sandbox.
  if (isArenaPreviewHost(host)) return "https";
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded === "https" || forwarded === "http") return forwarded;
  try {
    if (new URL(request.url).protocol === "https:") return "https";
  } catch {
    // Fall back to the host heuristic below.
  }

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

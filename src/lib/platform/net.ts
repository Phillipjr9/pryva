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

/** A deployment hostname must never be handed out as a customer-facing URL. */
function isVercelHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "vercel.app" || host.endsWith(".vercel.app");
}

function configuredOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || isVercelHost(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The canonical origin for customer-facing absolute links and email imagery. */
export function canonicalSiteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = configuredOrigin(env.NEXT_PUBLIC_SITE_URL) ?? configuredOrigin(env.NEXT_PUBLIC_APP_URL);
  if (explicit) return explicit;
  const productionHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const production = productionHost
    ? configuredOrigin(/^https?:\/\//i.test(productionHost) ? productionHost : `https://${productionHost}`)
    : null;
  // Vercel often supplies a *.vercel.app hostname here even for a site with a
  // custom domain. Do not leak that deployment address when the pin is absent.
  return production ?? "https://pryvalogs.com";
}

/** Hosts that are a deployment's plumbing, never the address a customer should be handed. */
function isDeploymentHost(host: string): boolean {
  const bare = host.split(":")[0].toLowerCase();
  if (isLocalHost(bare)) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare)) return true;
  return (
    bare.endsWith(".vercel.app") ||
    bare === "vercel.app" ||
    bare.endsWith(".e2b.app") ||
    bare.endsWith(".e2b.dev") ||
    bare.endsWith(".app.github.dev") ||
    bare.endsWith(".csb.app") ||
    bare.endsWith(".replit.dev")
  );
}

/**
 * Whether a pinned canonical origin should override the host that was asked.
 *
 * A pinned `NEXT_PUBLIC_SITE_URL` earns its keep on deployment hosts: the
 * `*.vercel.app` URL a preview is served from is not the address anyone should be
 * handed, so links and OAuth callbacks are rewritten to the canonical one.
 *
 * The moment the site is served from that canonical domain itself, the pin
 * becomes wrong — every referral link, OAuth callback, passkey origin and
 * Paystack callback minted on the custom domain would still name the old host.
 *
 * So there are three answers:
 *
 *   * canonical host or its `www.` sibling -> use the pin, so links never
 *     alternate between `www.` and the apex for the same site;
 *   * a deployment/preview/localhost host -> use the pin, because that URL is
 *     not one a customer should ever see;
 *   * any other real hostname -> describe the request. A site that has moved to
 *     its own domain must not keep minting URLs for a domain it no longer
 *     serves, and a host outside the canonical family is not ours to rewrite.
 */
function pinnedOriginApplies(host: string | null, env: NodeJS.ProcessEnv): boolean {
  const pinned = configuredOrigin(env.NEXT_PUBLIC_SITE_URL);
  if (!pinned) return false;
  if (!host) return true;
  let pinnedHost: string;
  try {
    pinnedHost = new URL(pinned).hostname.toLowerCase();
  } catch {
    return true;
  }
  const bare = host.split(":")[0].toLowerCase();
  const apex = pinnedHost.replace(/^www\./, "");
  if (bare === pinnedHost || bare === apex || bare === `www.${apex}`) return true;
  return isDeploymentHost(bare);
}

export function publicOrigin(request: Request, env: NodeJS.ProcessEnv = process.env): string {
  // Site owners can pin the public origin explicitly (needed for OAuth
  // redirect URIs when the gateway doesn't forward protocol headers). The `env`
  // parameter exists so callers that resolve configuration themselves — the
  // passkey relying party, which must use the same environment it validated —
  // are not quietly handed a different answer.
  const pinned = configuredOrigin(env.NEXT_PUBLIC_SITE_URL);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (pinned && pinnedOriginApplies(host, env)) return pinned;

  // Even without a pin, never mint a public callback or referral URL on Vercel's
  // deployment domain. In-memory preview hosts continue to describe themselves.
  if (host && isVercelHost(host.split(":")[0])) return canonicalSiteUrl(env);
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

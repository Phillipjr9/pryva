/**
 * One place that decides what "this site" means in an absolute URL.
 *
 * The sitemap, robots.txt, metadata base, JSON-LD, password resets, email
 * verification and delivery notices all used to hardcode `https://pryva.ng`.
 * That domain was never attached to the deployment: the live site is served
 * from `pryva-two.vercel.app`, so the sitemap published a list of URLs on a
 * host that does not resolve, robots.txt pointed at a sitemap nobody can read,
 * and every absolute link in an email pointed at a placeholder.
 *
 * Resolution order (first valid value wins):
 *
 *   1. `NEXT_PUBLIC_SITE_URL` — the pinned canonical/custom domain.
 *   2. `NEXT_PUBLIC_APP_URL` — the wallet's origin override.
 *   3. Vercel's injected production host, then its deployment host. These are
 *      always present on a Vercel build and always resolve, so a real
 *      deployment never has to fall back to an unattached domain.
 *   4. `https://pryva.ng` — only reachable in a local build or a test with no
 *      environment at all. The brand domain is intended to become #1 once it
 *      is attached; it is deliberately not used to guess a live host.
 *
 * Values that are obviously templates (`https://your-domain.com`) are refused
 * rather than shipped: a copied `.env.example` must not quietly become the
 * canonical origin of a production sitemap.
 *
 * This module is pure: metadata routes (which cannot read a request) and
 * server-side mail builders both need it, and neither should depend on the
 * request-derived origin in `net.ts` (that one answers a different question,
 * CSRF, and must keep using the pinned/observed host).
 */

type EnvLike = Record<string, string | undefined>;

/** Hostnames that may appear in a template but must never reach a customer. */
const PLACEHOLDER_HOSTS = new Set([
  "your-domain.com",
  "yourdomain.com",
  "example.com",
  "pryva.example",
]);

const BRAND_DOMAIN_FALLBACK = "https://pryva.ng";

/** Parse, validate and reduce to an origin (no path, query or trailing slash). */
function originFrom(raw: string | undefined, assumeHttps = false): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const candidate = assumeHttps && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? `https://${value}`
    : value;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (PLACEHOLDER_HOSTS.has(url.hostname.toLowerCase())) return null;
    // Reject a pinned origin carrying credentials or a port-less non-http
    // scheme; `origin` also strips any path someone typed into the variable.
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Vercel injects bare hostnames; the production alias wins over a preview URL. */
function vercelOrigin(env: EnvLike): string | null {
  return (
    originFrom(env.VERCEL_PROJECT_PRODUCTION_URL, true) ??
    originFrom(env.VERCEL_URL, true)
  );
}

/** Canonical origin for crawlers, metadata and structured data. */
export function canonicalSiteUrl(env: EnvLike = process.env): string {
  return (
    originFrom(env.NEXT_PUBLIC_SITE_URL) ??
    originFrom(env.NEXT_PUBLIC_APP_URL) ??
    vercelOrigin(env) ??
    BRAND_DOMAIN_FALLBACK
  );
}

/**
 * Origin for links a customer clicks in an email. `NEXT_PUBLIC_APP_URL` takes
 * precedence here because it exists to override the wallet's return origin;
 * the canonical domain is next, then Vercel's live host.
 */
export function appLinkOrigin(env: EnvLike = process.env): string {
  return (
    originFrom(env.NEXT_PUBLIC_APP_URL) ??
    originFrom(env.NEXT_PUBLIC_SITE_URL) ??
    vercelOrigin(env) ??
    BRAND_DOMAIN_FALLBACK
  );
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { persistentDatabaseConfigured } from "@/lib/platform/database-config";
import { safeRedirectPath } from "@/lib/platform/safe-redirect";

/**
 * Where an isolated preview opens.
 *
 * ## The problem this solves
 *
 * The preview pane loads `/`, which is the storefront. Reviewing the operator
 * console then means typing `/admin` every time the pane reloads. This lets a
 * preview open on the console instead, without teaching the storefront to send
 * real visitors away from the home page.
 *
 * ## The two locks
 *
 *   1. `PREVIEW_LANDING_PATH` — an explicit opt-in, unset by default. It must be
 *      `/admin` or a path below it; anything else is ignored, so the variable
 *      cannot bounce visitors to an arbitrary or off-site URL.
 *   2. No persistent database — `persistentDatabaseConfigured()`, the same
 *      predicate that decides whether the in-memory shim answers queries. A
 *      deployment wired to Postgres (by URL or RDS IAM) never redirects, whatever
 *      the first lock says.
 *
 * ## What it does and does not change
 *
 * A landing convenience, not an access control. It applies to the site root only
 * and only for as long as the flag is set, so every other storefront path keeps
 * working and `/` itself stays reachable on request (see below). What an operator
 * may see is still decided by `requireAdmin` on every request.
 *
 * ## Why there is no "first visit" cookie
 *
 * An earlier version marked the browser once and stopped redirecting. That reads
 * well in a unit test and behaves badly in a preview pane: the marker outlives the
 * review, so the next reload — or the next day's review of the same sandbox —
 * opens the shop instead of the console. The landing is now a property of the
 * deployment, not of a cookie, and the two ways to ask for the shop are explicit:
 *
 *   • `/?storefront=1` — a link that means it, shareable and bookmarkable.
 *   • A same-origin navigation from inside `/admin` — the console's own
 *     "View storefront" link, which sends `Referer` under the app's
 *     `origin-when-cross-origin` policy.
 */

/** Query flag that asks for the storefront even while the preview lands on /admin. */
export const STOREFRONT_PARAM = "storefront";

/** The configured console path, or null when this deployment must not redirect. */
export function previewLandingPath(): string | null {
  const configured = process.env.PREVIEW_LANDING_PATH?.trim();
  if (!configured) return null;
  if (persistentDatabaseConfigured()) return null;
  const path = safeRedirectPath(configured, "");
  if (!path) return null;
  // Compare the resolved path, not the written one: `/admin/../../etc` starts
  // with `/admin` but a browser leaves the console. The query is the visitor's,
  // appended below, so a configured one is a mistake rather than a feature.
  let resolved: string;
  try {
    const url = new URL(path, "https://local.invalid");
    if (url.search || url.hash) return null;
    resolved = url.pathname;
  } catch { return null; }
  return resolved === "/admin" || resolved.startsWith("/admin/") ? resolved : null;
}

/** True when the visitor came from the console and asked to see the shop. */
function fromConsole(request: NextRequest): boolean {
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    const url = new URL(referer);
    // Only a same-origin referrer counts; another site linking here must not be
    // able to choose which page this deployment opens.
    if (url.host !== request.nextUrl.host) return false;
    return url.pathname === "/admin" || url.pathname.startsWith("/admin/");
  } catch { return false; }
}

/**
 * A redirect built on the request's own URL.
 *
 * `Location` must be absolute here: Next's proxy adapter re-parses the header
 * with `new NextURL(location)` and no base, so a bare `/admin/overview` throws
 * `ERR_INVALID_URL` and the visitor gets a 500. The adapter relativizes it again
 * on the way out when the host matches, so the sandbox's internal host never
 * reaches the browser.
 *
 * Only a real navigation is redirected. A prefetch or an RSC payload request for
 * `/` — Next issues those for the console's own storefront link — must not be
 * sent to the console. `Sec-Fetch-Dest` is the guard that actually fires: Next 16
 * consumes the `RSC` and `Next-Router-Prefetch` headers before the proxy runs, so
 * those are checked as a backstop for other runtimes rather than relied on. A
 * fetch is `empty`, a top-level navigation `document`, and the preview pane's
 * frame `iframe`; curl and older clients send nothing, which is treated as a
 * navigation so the preview still lands.
 */
export function previewLandingRedirect(request: NextRequest): NextResponse | null {
  const target = previewLandingPath();
  if (!target) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (request.nextUrl.pathname !== "/") return null;
  if (request.nextUrl.searchParams.has(STOREFRONT_PARAM)) return null;
  if (fromConsole(request)) return null;

  const destination = request.headers.get("sec-fetch-dest");
  if (destination && destination !== "document" && destination !== "iframe") return null;
  if (request.headers.get("rsc") || request.headers.get("next-router-prefetch")) return null;

  // Keep the visitor's query: a preview link may carry one, and dropping it
  // silently is worse than passing it to a page that ignores it.
  const location = new URL(`${target}${request.nextUrl.search}`, request.nextUrl);
  return NextResponse.redirect(location, 307);
}

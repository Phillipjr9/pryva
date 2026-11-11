import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * `next/link` for the public pages, minus the prefetches that cannot help.
 *
 * ## What a link costs before anybody clicks it
 *
 * In production Next prefetches every `<Link>` as it scrolls into view. For a
 * prerendered page that is a good trade: the payload comes from the edge cache
 * and the click is instant. For a page that is rendered per request there is
 * nothing to fetch ahead of time — the server answers with a few hundred bytes
 * that say so — but the question is still asked, it cannot be cached, and it is
 * answered by the application. One function invocation per link, per visitor,
 * for a response that is thrown away.
 *
 * The homepage links to ten such pages. A visitor who scrolls to the footer
 * asks about all of them, so a hundred thousand visitors arriving together are
 * over a million uncacheable requests on top of the pages they actually came
 * for. That is the gap between "the homepage is served from the cache" and "the
 * homepage does not wake the application".
 *
 * ## What this changes
 *
 * Links to those routes are rendered with `prefetch={false}`. Nothing else is
 * different: the link is the same `<a>`, a click navigates exactly as before
 * (it always needed the round trip), and links to prerendered pages keep their
 * prefetch. A caller that passes `prefetch` itself is left alone.
 *
 * ## Keeping the list true
 *
 * `PER_REQUEST_ROUTES` is checked against the pages' own source in
 * `src/test/public-shell-static.test.tsx`, both ways. A wrong entry is cheap in
 * either direction — a static page that is listed loses its prefetch, a dynamic
 * page that is not listed costs one wasted request — but the test is what stops
 * the list from quietly describing last year's site.
 */
export const PER_REQUEST_ROUTES: ReadonlySet<string> = new Set([
  "/accounts",
  "/contact",
  "/esim",
  "/login",
  "/pricing",
  "/reviews",
  "/signup",
  "/status",
  "/testimonials",
  "/virtual-numbers",
]);

/** The route a link points at, without its query string, fragment or trailing slash. */
function routeOf(href: string): string {
  const path = href.split(/[?#]/, 1)[0] ?? "";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** True when prefetching `href` would reach the application and bring nothing back. */
export function rendersPerRequest(href: string): boolean {
  return PER_REQUEST_ROUTES.has(routeOf(href));
}

export function SiteLink({ prefetch, ...props }: ComponentProps<typeof Link>) {
  const href = typeof props.href === "string" ? props.href : (props.href.pathname ?? "");
  const decided = prefetch !== undefined ? prefetch : rendersPerRequest(href) ? false : undefined;
  return <Link {...props} prefetch={decided} />;
}

/**
 * Legacy routes that must keep working after a page moves.
 *
 * `securityRedirectTarget` is the one piece of logic in
 * `src/app/dashboard/security/page.tsx`, pulled out here so it can be tested
 * without a request scope. The page itself only calls it and redirects.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Where `/dashboard/security` sends a visitor now that security is a section of
 * Settings rather than a page of its own.
 *
 * The query string is carried across deliberately. The link that must not break
 * is the administrator bounce: an operator without two-factor who opens
 * `/admin/*` is redirected to `/dashboard/security?require=2fa&next=…`, and a
 * bare redirect to `/dashboard/settings` would drop the `require=2fa` and land
 * them on a page that looks unrelated to the refusal they just saw. Repeated
 * keys (`?a=1&a=2`) keep the first value, which is what Next hands a route
 * handler as an array and the only one the page ever read.
 */
export function securityRedirectTarget(params: SearchParams): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value !== "") search.set(key, value);
    else if (Array.isArray(value) && typeof value[0] === "string" && value[0] !== "") {
      search.set(key, value[0]);
    }
  }

  const query = search.toString();
  return `/dashboard/settings${query ? `?${query}` : ""}#security`;
}

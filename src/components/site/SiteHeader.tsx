import { SiteHeaderNav } from "@/components/site/HeaderNav";

/**
 * The public header.
 *
 * Deliberately not `async`, and deliberately free of `getCurrentUser()`. It used
 * to read the session here, on the server, to choose between "Sign in" and
 * "Dashboard" — and because this component sits in the layout of every public
 * page, that one cookie read made the whole marketing site render per request.
 * Nothing under `(site)` could be prerendered or cached at the edge, so a burst
 * of visitors to the homepage was a burst of function invocations.
 *
 * The sign-in state is now resolved in the browser (`SiteSession`), and this
 * renders the same markup for everybody. `src/test/public-shell-static.test.tsx`
 * keeps request-time reads out of the shell.
 */
export function SiteHeader() {
  return <SiteHeaderNav />;
}

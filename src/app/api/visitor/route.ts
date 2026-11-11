import { getCurrentUser } from "@/lib/identity/auth";

export const dynamic = "force-dynamic";

/**
 * "Who is this visitor?" for the public pages, asked from the browser.
 *
 * ## Why this exists
 *
 * The public shell used to answer that question on the server: the header read
 * the session cookie while rendering, which made every marketing page a
 * per-request render. A hundred thousand visitors arriving together meant a
 * hundred thousand function invocations before anybody saw HTML, and the page
 * could not be served from the edge cache at all — a page that reads a cookie
 * is, by definition, different for every request.
 *
 * Now the page is prerendered once and shared, and the two things that depend on
 * the visitor (the header's buttons, a handful of links) ask here after the page
 * has loaded. A burst is served its HTML from the cache; what still reaches the
 * application is this one small request per visitor, and if it is slow or
 * refused the page is already on screen with the signed-out links.
 *
 * ## What it costs
 *
 * A visitor with no session cookie never reaches the database: `getCurrentUser`
 * has no token to look up and returns at once. A visitor with a cookie costs one
 * indexed session lookup, which is what every page render used to cost them.
 *
 * ## What it returns
 *
 * Exactly what the header rendered before, and nothing else: a display name and
 * a wallet balance. No id, no email, no role — this response is read by scripts
 * on public pages, so it carries the least that makes the header correct. It is
 * never cached; `src/proxy.ts` marks every `/api/` response `no-store` as well.
 *
 * A failure to resolve the session answers "signed out" rather than an error.
 * The public page is already rendered for a signed-out visitor, so that is the
 * safe default, and the dashboard still enforces its own sign-in.
 *
 * ## Why it is not under `/api/auth/`
 *
 * Every public page view calls this once. `/api/auth/` is the prefix an edge
 * rate-limit rule is meant to cover (see BOT_ATTACK_FINDINGS.md: ten requests a
 * minute per address), and that budget is for sign-in, signup and password
 * reset. A read that fires on every page load would spend it for people who are
 * only browsing — and for everyone behind the same office or carrier address —
 * until a genuine sign-in was the request that got challenged.
 */
export async function GET() {
  let user: { name: string; walletBalance: number } | null = null;
  try {
    const current = await getCurrentUser();
    if (current) user = { name: current.name, walletBalance: current.walletBalance };
  } catch {
    user = null;
  }

  return Response.json({ user }, { headers: { "Cache-Control": "private, no-store" } });
}

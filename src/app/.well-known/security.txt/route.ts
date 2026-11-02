import { canonicalSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/security.txt
 *
 * This used to be a static file in `public/` hardcoding `https://pryva.ng`, a
 * domain that was never attached to the deployment. A security contact pointing
 * at a dead host is worse than none: a researcher who finds a problem has
 * nowhere to send it. Serving it from the same resolver the sitemap, robots.txt
 * and mail links use keeps Contact and Canonical on the host actually serving
 * the page.
 *
 * Dynamic rather than prerendered so a deployment whose domain changes does not
 * publish a stale contact until the next build.
 */
export async function GET() {
  const site = canonicalSiteUrl();
  const body = [
    `Contact: ${site}/contact`,
    "Expires: 2027-10-30T00:00:00.000Z",
    "Preferred-Languages: en",
    `Canonical: ${site}/.well-known/security.txt`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}

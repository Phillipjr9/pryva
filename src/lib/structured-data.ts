/**
 * Sitewide structured data: who publishes this site, and what the site is.
 *
 * The homepage already emits `FAQPage` for the six questions it answers. These
 * two nodes answer the questions a search engine asks about the *publisher*
 * instead — the organisation behind the pages, its logo, and the site's own
 * name — which is what turns a list of matching pages into a recognised brand.
 *
 * Everything here is built from constants and is already stated on a public
 * page. There is deliberately no `aggregateRating`, no `review`, no
 * `foundingDate`, no `address`, no `telephone` and no `sameAs`: Pryva has no
 * published reviews yet, no published street address, and no social profiles
 * confirmed for this site. Inventing them to win a rich result would be the
 * same lie as a seeded testimonial, in a format crawlers believe.
 */

/** The canonical origin. `metadataBase` in `layout.tsx` uses the same value. */
export const SITE_URL = "https://pryva.ng";

export type StructuredDataNode = Record<string, unknown>;

/**
 * The organisation. `description` is the same sentence the page metadata and
 * the homepage use, so the machine-readable copy cannot drift from the copy a
 * visitor reads.
 */
export function organizationSchema(): StructuredDataNode {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: "Pryva",
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/icons/icon-512.png`,
      width: 512,
      height: 512,
    },
    description:
      "Pryva sells virtual numbers, eSIM data, residential proxies, temporary email inboxes and digital accounts, priced in Naira.",
    areaServed: { "@type": "Country", name: "Nigeria" },
  };
}

/**
 * The site itself, published by the organisation above via `@id` reference
 * rather than a duplicated copy of it.
 */
export function websiteSchema(): StructuredDataNode {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: "Pryva",
    url: SITE_URL,
    inLanguage: "en-NG",
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

/** Emitted once, in the root layout, for every page. */
export const siteStructuredData: StructuredDataNode[] = [organizationSchema(), websiteSchema()];

/**
 * JSON for a `<script type="application/ld+json">` block.
 *
 * `JSON.stringify` leaves `<` and `>` intact, so a stray `</script>` inside a
 * string would end the block early. Nothing here is user input, but escaping
 * the two characters is one line and removes the need to remember that.
 */
export function serializeStructuredData(data: StructuredDataNode | StructuredDataNode[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

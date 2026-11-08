import React from "react";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ServiceIcon, CategoryIcon, type ServiceType } from "@/components/ServiceIcon";
import { NetworkBadge } from "@/components/NetworkBadge";
import { BRAND_MARKS } from "@/lib/content/brand-marks";
import { BrandIcon, WORDMARK_BRANDS } from "@/components/BrandIcon";
import { PlatformBadge, type PlatformSlug } from "@/components/PlatformBadge";
import { PROMOTION_EXAMPLES, VERIFICATION_EXAMPLES } from "@/lib/services/service-explorer";
import { digitalServices } from "@/lib/services/digital/digital-services";

/**
 * Every service shows its own icon, and no icon is generated artwork.
 *
 * Two rules, both asserted here so neither can drift:
 *
 *   1. Third-party products (Netflix, Canva, Outlook…) show the REAL mark from
 *      `BRAND_MARKS` — official path data from the open icon sets. Never
 *      generated, never redrawn by eye, and never shadowed by a wordmark when a
 *      real mark exists.
 *   2. Pryva's own catalogue (virtual numbers, eSIM, proxies…) has no official
 *      logo to reproduce, so it is drawn from the interface's own flat 24×24
 *      stroked set. It used to be a shelf of generated 3D renders; the owner asked
 *      for those to go, and `public/images/{services,categories,nav,avatars}` no
 *      longer exists.
 *
 * The earlier audit's three failure modes are still pinned: a service page with
 * no icon at all, `ServiceIcon`'s old `FALLBACK_IMAGE` that drew the virtual
 * numbers art for any unmapped key, and `NetworkBadge`'s fallback that drew
 * Airtel's logo for every unlisted provider.
 */

/** Pryva's own catalogue. Each must render a distinct flat glyph. */
const CATALOGUE_SERVICES = [
  "numbers", "esim", "proxies", "email-otp", "data", "gift-cards",
  "bulk", "scheduled",
] as const;

/** Brand-backed family pages that intentionally show the platform's own mark. */
const BRANDED_FAMILIES = [
  ["accounts", "Netflix"],
  ["subscriptions", "Spotify"],
  ["app-verification", "Google"],
  ["social-promotion", "Instagram"],
] as const;

/** Third-party products: slug -> the accessible name of the real mark. */
const DIGITAL_MARKS: Record<string, string> = {
  netflix: "Netflix",
  spotify: "Spotify",
  youtube: "YouTube",
  disney: "Disney+",
  chatgpt: "ChatGPT",
  canva: "Canva",
};

/**
 * What a glyph actually draws — its identity, independent of size and label.
 *
 * The inner markup, not just `<path d>`: several glyphs in the house set are
 * built from `<rect>` and `<circle>` (Calendar, Grid, IdCard), and a path-only
 * reading called those "empty".
 */
function shapeOf(html: string): string {
  return [...html.matchAll(/<svg[^>]*>([\s\S]*?)<\/svg>/g)].map((m) => m[1]).join("|");
}

describe("service logos", () => {
  it("gives every catalogue service a flat glyph, and no two share one", () => {
    const shapes = new Set<string>();

    for (const service of CATALOGUE_SERVICES) {
      const html = renderToStaticMarkup(<ServiceIcon service={service as ServiceType} />);
      expect(html, `${service} must draw an svg`).toContain("<svg");
      expect(html, `${service} must not load a picture`).not.toContain("<img");
      expect(html, `${service} must not reference generated artwork`).not.toContain("/images/");

      const shape = shapeOf(html);
      expect(shape, `${service} draws nothing`).not.toBe("");
      shapes.add(shape);
    }

    expect(shapes.size).toBe(CATALOGUE_SERVICES.length);
  });

  it("gives every category a flat glyph, and no two share one", () => {
    const shapes = new Set<string>();

    for (const category of ["streaming", "music", "gaming", "productivity"] as const) {
      const html = renderToStaticMarkup(<CategoryIcon category={category} />);
      expect(html).toContain("<svg");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("/images/");
      shapes.add(shapeOf(html));
    }

    expect(shapes.size).toBe(4);
  });

  it("ships no generated 3D artwork at all", () => {
    // The owner asked for the 3D set to be removed, not swapped for another set
    // of pictures. If a folder comes back, something is loading raster icons
    // again and the byte cost comes back with it.
    for (const folder of ["services", "categories", "nav", "avatars"]) {
      expect(existsSync(`public/images/${folder}`), `public/images/${folder} is back`).toBe(false);
    }
    expect(existsSync("scripts/build-service-artwork.mjs")).toBe(false);
    expect(existsSync("src/lib/services/service-artwork.ts")).toBe(false);
  });

  it("gives every third-party product its real mark, never generated art", () => {
    const shapes = new Set<string>();

    for (const [service, name] of Object.entries(DIGITAL_MARKS)) {
      const html = renderToStaticMarkup(<ServiceIcon service={service as ServiceType} />);
      expect(html).toContain(`aria-label="${name}"`);
      expect(html, `${service} must not fall back to artwork`).not.toContain("/images/");
      shapes.add(html.slice(html.indexOf("<svg"), html.lastIndexOf("</svg>") + 6) || html);
    }

    expect(shapes.size).toBe(Object.keys(DIGITAL_MARKS).length);
  });

  it("uses a real brand mark for the platform-style service families that have one", () => {
    for (const [service, expectedLabel] of BRANDED_FAMILIES) {
      const html = renderToStaticMarkup(<ServiceIcon service={service} />);
      expect(html, `${service} should use the platform's mark`).toContain(`aria-label="${expectedLabel}"`);
      expect(html).not.toContain("/images/");
    }
  });

  it("never draws another service's icon for an unknown key", () => {
    // The old FALLBACK_IMAGE made this render the virtual-numbers artwork, which
    // is how a typo in one page could ship the wrong logo for months.
    const html = renderToStaticMarkup(<ServiceIcon service={"not-a-service" as ServiceType} />);
    expect(html).not.toContain("/images/");
    expect(html).toContain('aria-label="not-a-service"');
    expect(html).toContain("<svg");
    // The neutral tile must not be any real service's glyph.
    for (const service of CATALOGUE_SERVICES) {
      expect(shapeOf(html)).not.toBe(shapeOf(renderToStaticMarkup(<ServiceIcon service={service} />)));
    }
  });

  it("uses the real Email OTP brand mark instead of the generic Pryva mail glyph", () => {
    const labelled = renderToStaticMarkup(<ServiceIcon service="email-otp" />);
    expect(labelled).toContain('aria-label="Gmail"');
    expect(labelled).toContain('role="img"');
    expect(labelled).not.toContain('aria-label="Email OTP"');

    const decorative = renderToStaticMarkup(<ServiceIcon service="email-otp" decorative />);
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain("aria-label=");
  });

  it("puts a network's own mark on every network badge", () => {
    const expected: Record<string, string> = {
      mtn: "MTN",
      airtel: "Airtel",
      glo: "Glo",
      "9mobile": "9mobile",
    };
    const markup = new Map<string, string>();

    for (const [provider, name] of Object.entries(expected)) {
      const html = renderToStaticMarkup(<NetworkBadge provider={provider as "mtn"} />);
      expect(html).toContain(`aria-label="${name}"`);
      markup.set(provider, html);
    }

    // Four providers, four different badges. The old fallback gave every
    // unlisted provider Airtel's logo.
    expect(new Set(markup.values()).size).toBe(Object.keys(expected).length);
    // Airtel ships a real mark; the other three carry their wordmark.
    expect(markup.get("airtel")).toContain("<svg");
    expect(markup.get("mtn")).toContain(">MTN<");
    expect(markup.get("glo")).toContain(">glo<");
    expect(markup.get("9mobile")).toContain(">9mobile<");
  });

  it("renders a visible mark for every platform the explorer can list", () => {
    // These are platforms, not Pryva services: the explorer draws them with
    // BrandIcon. An empty string is the failure mode — BrandIcon returns null
    // for an unknown slug, which shows up as a blank tile nobody notices.
    const brands = new Set<string>([
      ...VERIFICATION_EXAMPLES.map((item) => item.brand),
      ...PROMOTION_EXAMPLES.map((item) => item.brand),
    ]);

    for (const brand of brands) {
      const html = renderToStaticMarkup(<BrandIcon brand={brand as never} />);
      expect(html, `${brand} renders nothing`).not.toBe("");
      expect(html, `${brand} has no accessible name`).toContain("aria-label=");
      expect(html, `${brand} must not load generated artwork`).not.toContain("/images/");
    }
  });

  it("uses the real mark for every platform that has one, in every category", () => {
    // The wordmark table is a fallback, not an override. Outlook sat in both
    // tables and was drawn as text while its official mark shipped unused.
    for (const slug of Object.keys(BRAND_MARKS)) {
      const html = renderToStaticMarkup(<BrandIcon brand={slug as never} />);
      expect(html, `${slug} has a real mark but rendered no svg`).toContain("<svg");
    }
  });

  it("gives every marketplace platform its own badge", () => {
    const platforms: PlatformSlug[] = [
      "facebook", "instagram", "tiktok", "gmail", "outlook", "x", "telegram",
      "whatsapp", "discord", "youtube", "netflix", "spotify", "steam",
    ];

    for (const platform of platforms) {
      const html = renderToStaticMarkup(<PlatformBadge platform={platform} />);
      expect(html, `${platform} renders nothing`).not.toBe("");
      const label = html.match(/aria-label="([^"]+)"/)?.[1];
      expect(label, `${platform} has no accessible name`).toBeTruthy();
    }

    // Outlook DOES ship an official mark, so it must be drawn, not spelled.
    const outlook = renderToStaticMarkup(<PlatformBadge platform="outlook" />);
    expect(outlook).toContain("<svg");
    expect(outlook).not.toContain(">Outlook<");

    // The neutral fallback must not impersonate a real platform.
    const generic = renderToStaticMarkup(<PlatformBadge detectFrom="something unmapped" />);
    expect(generic).toContain('aria-label="Digital account"');
  });

  it("keeps the wordmark list to the brands that really have no mark", () => {
    // Both halves matter: a brand with an official mark must never be painted as
    // a wordmark, and a brand without one must never be invented.
    for (const slug of Object.keys(WORDMARK_BRANDS)) {
      expect(BRAND_MARKS, `${slug} has a real mark, so it must use it`).not.toHaveProperty(slug);
    }
    expect(Object.keys(WORDMARK_BRANDS).sort()).toEqual(
      ["9mobile", "disney-plus", "glo", "mtn"].sort(),
    );
  });

  it("covers every subscription the dashboard sells", () => {
    for (const service of digitalServices) {
      expect(DIGITAL_MARKS, `${service.slug} has no mark mapped`).toHaveProperty(service.slug);
    }
  });

  it("shows the service's own icon on each service page and dashboard section", () => {
    // A rendered-output assertion needs a database, so this reads the sources:
    // the report that started this work was a page with no icon in its markup,
    // and that is exactly what this catches.
    const surfaces: Array<[string, string]> = [
      ["src/app/(site)/email-otp/page.tsx", 'service="email-otp"'],
      ["src/app/(site)/esim/page.tsx", 'service="esim"'],
      ["src/app/(site)/proxies/page.tsx", 'service="proxies"'],
      ["src/app/(site)/virtual-numbers/page.tsx", 'service="numbers"'],
      ["src/app/(site)/accounts/page.tsx", 'service="accounts"'],
      ["src/app/(site)/gift-cards/page.tsx", 'service="gift-cards"'],
      ["src/app/dashboard/inbox/page.tsx", 'service="email-otp"'],
      ["src/app/dashboard/accounts/page.tsx", 'service="accounts"'],
      ["src/app/dashboard/data/page.tsx", 'service="data"'],
      ["src/app/dashboard/gift-cards/page.tsx", 'service="gift-cards"'],
      ["src/app/dashboard/bulk-orders/page.tsx", 'service="bulk"'],
      ["src/app/dashboard/scheduled/page.tsx", 'service="scheduled"'],
    ];

    for (const [file, service] of surfaces) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} shows no service icon`).toContain(service);
      expect(source, `${file} does not import the icon component`).toMatch(
        /import \{(?: ServiceIcon| ServiceTitle) \} from "@\/components\/(?:ServiceIcon|ServiceTitle)"/,
      );
    }
  });
});

/**
 * Icons cost no image bytes.
 *
 * The 3D set was 9.5 MB on disk: a 512×512 master plus three WebP derivatives
 * for every service, category, sidebar row and avatar. Inline glyphs are a few
 * hundred bytes of markup that the page already has, so there is no request, no
 * decode and nothing to regenerate.
 */
describe("icon weight", () => {
  it("renders inline markup rather than an image request", () => {
    for (const service of CATALOGUE_SERVICES) {
      const html = renderToStaticMarkup(<ServiceIcon service={service} size="md" />);
      expect(html).not.toContain("<img");
      expect(html).not.toContain("srcSet");
      expect(html).toContain("<svg");
    }
  });

  it("keeps the slot sizes the layout was built around", () => {
    for (const [size, px] of [["xs", 20], ["sm", 32], ["md", 48], ["lg", 64]] as const) {
      const html = renderToStaticMarkup(<ServiceIcon service="esim" size={size} />);
      expect(html).toContain(`width:${px}px`);
      expect(html).toContain(`height:${px}px`);
    }
  });
});

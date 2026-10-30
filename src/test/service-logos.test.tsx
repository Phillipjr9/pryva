import React from "react";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ServiceIcon, type ServiceType } from "@/components/ServiceIcon";
import { NetworkBadge } from "@/components/NetworkBadge";
import { BRAND_MARKS } from "@/lib/brand-marks";
import { BrandIcon, WORDMARK_BRANDS } from "@/components/BrandIcon";
import { PlatformBadge, platformName, type PlatformSlug } from "@/components/PlatformBadge";
import { PROMOTION_EXAMPLES, VERIFICATION_EXAMPLES } from "@/lib/service-explorer";
import { digitalServices } from "@/lib/digital-services";

/**
 * Every service shows its own icon.
 *
 * The owner reported that the Email OTP page — and, on inspection, every other
 * service page — rendered no icon at all, while the cards that linked to them
 * did. The audit that followed found three ways a service could end up with the
 * wrong mark, and this file locks all three down:
 *
 *   1. a service page/dashboard section with no icon (`ServiceTitle`, and the
 *      direct `<ServiceIcon>` in each site hero);
 *   2. `ServiceIcon`'s old `FALLBACK_IMAGE`, which drew the *virtual numbers*
 *      artwork for any unmapped key;
 *   3. `NetworkBadge`'s old fallback, which drew *Airtel's* logo for any
 *      provider without a wordmark entry.
 *
 * Pryva's own services keep their generated 3D artwork on purpose: there is no
 * official logo for "virtual numbers", and the marks they could borrow (Gmail,
 * Outlook, the carriers) belong to services the customer supplies, not to the
 * Pryva product being described. Third-party products (Netflix, Canva…) use the
 * real mark from `BRAND_MARKS`. Both rules are asserted here so neither can
 * drift. `STATUS.md` §17 records the full surface-by-surface audit.
 */

/** Pryva's own catalogue: slug -> artwork file. */
const CATALOGUE_ARTWORK: Record<string, string> = {
  numbers: "virtual-numbers",
  esim: "esim",
  proxies: "proxies",
  "email-otp": "email-otp",
  accounts: "digital-accounts",
  data: "data",
  "gift-cards": "gift-cards",
  bulk: "bulk",
  scheduled: "scheduled",
};

/** Third-party products: slug -> the accessible name of the real mark. */
const DIGITAL_MARKS: Record<string, string> = {
  netflix: "Netflix",
  spotify: "Spotify",
  youtube: "YouTube",
  disney: "Disney+",
  chatgpt: "ChatGPT",
  canva: "Canva",
};

function hash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function svgOf(html: string): string {
  const start = html.indexOf("<g");
  return start === -1 ? "" : html.slice(start, html.lastIndexOf("</g>") + 4);
}

describe("service logos", () => {
  it("gives every catalogue service its own artwork, and no two share one", () => {
    const sources = new Set<string>();

    for (const [service, file] of Object.entries(CATALOGUE_ARTWORK)) {
      const html = decodeURIComponent(renderToStaticMarkup(<ServiceIcon service={service as ServiceType} />));
      expect(html, `${service} should use /images/services/${file}.png`).toContain(`/images/services/${file}.png`);
      expect(existsSync(`public/images/services/${file}.png`), `${file}.png is missing`).toBe(true);
      sources.add(html);
    }

    expect(sources.size).toBe(Object.keys(CATALOGUE_ARTWORK).length);
  });

  it("ships nine distinct artwork files", () => {
    const hashes = new Set<string>();
    for (const file of Object.values(CATALOGUE_ARTWORK)) {
      const path = `public/images/services/${file}.png`;
      expect(existsSync(path), `${path} is missing`).toBe(true);
      hashes.add(hash(path));
    }
    // A copied file would render the wrong logo under the right name.
    expect(hashes.size).toBe(Object.keys(CATALOGUE_ARTWORK).length);
  });

  it("gives every third-party product its real mark, never generated art", () => {
    const shapes = new Set<string>();

    for (const [service, name] of Object.entries(DIGITAL_MARKS)) {
      // No decodeURIComponent here: brand SVG path data is not URL-encoded and
      // decoding it throws on a stray '%'.
      const html = renderToStaticMarkup(<ServiceIcon service={service as ServiceType} />);
      expect(html).toContain(`aria-label="${name}"`);
      expect(html, `${service} must not fall back to artwork`).not.toContain("/images/services/");
      shapes.add(svgOf(html));
    }

    expect(shapes.size).toBe(Object.keys(DIGITAL_MARKS).length);
  });

  it("never draws another service's logo for an unknown key", () => {
    // The old FALLBACK_IMAGE made this render the virtual-numbers artwork, which
    // is how a typo in one page could ship the wrong logo for months.
    const html = decodeURIComponent(
      renderToStaticMarkup(<ServiceIcon service={"not-a-service" as ServiceType} />),
    );
    expect(html).not.toContain("/images/services/");
    expect(html).toContain('aria-label="not-a-service"');
    expect(html).toContain("<svg");
  });

  it("names the icon only when nothing else does", () => {
    const labelled = renderToStaticMarkup(<ServiceIcon service="email-otp" />);
    expect(labelled).toContain('alt="Email OTP"');

    const decorative = renderToStaticMarkup(<ServiceIcon service="email-otp" decorative />);
    expect(decorative).toContain('alt=""');
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
    // BrandIcon. A wordmark (Disney+, Outlook) is still a visible mark; an empty
    // string is the failure mode — BrandIcon returns null for an unknown slug,
    // which shows up as a blank tile nobody notices.
    const brands = new Set<string>([
      ...VERIFICATION_EXAMPLES.map((item) => item.brand),
      ...PROMOTION_EXAMPLES.map((item) => item.brand),
    ]);

    for (const brand of brands) {
      const html = renderToStaticMarkup(<BrandIcon brand={brand as never} />);
      expect(html, `${brand} renders nothing`).not.toBe("");
      expect(html, `${brand} has no accessible name`).toContain("aria-label=");
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

    // Outlook is one of the brands with no redistributable mark, so its badge is
    // the wordmark tile — still legible, still namable, just not the official
    // lockup. That is the honest option the audit settled on.
    expect(renderToStaticMarkup(<PlatformBadge platform="outlook" />)).toContain(">Outlook<");

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
      ["9mobile", "disney-plus", "glo", "mtn", "outlook"].sort(),
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

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SITE_URL,
  organizationSchema,
  serializeStructuredData,
  siteStructuredData,
  websiteSchema,
} from "@/lib/structured-data";

const layout = readFileSync("src/app/layout.tsx", "utf8");
const globals = readFileSync("src/app/globals.css", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies: Record<string, string>;
};

describe("sitewide structured data", () => {
  it("describes the organisation without inventing anything about it", () => {
    const org = organizationSchema();
    expect(org["@type"]).toBe("Organization");
    expect(org.name).toBe("Pryva");
    expect(org.url).toBe(SITE_URL);
    expect(org["@id"]).toBe(`${SITE_URL}/#organization`);
    expect((org.logo as { url: string }).url).toBe(`${SITE_URL}/icons/icon-512.png`);

    // The claims a crawler will happily repeat. Pryva has no published reviews,
    // no street address and no confirmed social profiles, so none may appear.
    for (const forbidden of [
      "aggregateRating",
      "review",
      "ratingValue",
      "foundingDate",
      "address",
      "telephone",
      "sameAs",
      "award",
    ]) {
      expect(org, `structured data must not claim ${forbidden}`).not.toHaveProperty(forbidden);
    }
  });

  it("points the site node at the organisation instead of duplicating it", () => {
    const site = websiteSchema();
    const org = organizationSchema();
    expect(site["@type"]).toBe("WebSite");
    expect(site.url).toBe(SITE_URL);
    expect(site.inLanguage).toBe("en-NG");
    expect((site.publisher as { "@id": string })["@id"]).toBe(org["@id"]);
  });

  it("uses the canonical origin the rest of the app uses", () => {
    expect(SITE_URL).toBe("https://pryva.ng");
    expect(layout).toContain(`new URL("${SITE_URL}")`);
    expect(globals).toContain("--font-sans");
    expect(globals).toContain("--font-display");
  });

  it("emits valid JSON that cannot close its own script block", () => {
    const json = serializeStructuredData(siteStructuredData);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).not.toContain("</script");
    expect(json).not.toContain("<");
    expect(json).not.toContain(">");

    const parsed = JSON.parse(json) as Array<{ "@type": string }>;
    expect(parsed.map((node) => node["@type"])).toEqual(["Organization", "WebSite"]);
  });

  it("is rendered once, in the root layout, so every page carries it", () => {
    expect(layout).toContain('type="application/ld+json"');
    expect(layout).toContain("serializeStructuredData(siteStructuredData)");
  });
});

describe("self-hosted webfonts", () => {
  const weights = ["300", "400", "500", "600", "700", "800"];

  it("imports every weight the design uses from @fontsource", () => {
    for (const weight of weights) {
      expect(layout, `weight ${weight} is not imported`).toContain(
        `@fontsource/plus-jakarta-sans/${weight}.css`,
      );
    }
    expect(layout).toContain("@fontsource/instrument-serif/400.css");
    expect(layout).toContain("@fontsource/instrument-serif/400-italic.css");
    expect(pkg.dependencies["@fontsource/plus-jakarta-sans"]).toBeTruthy();
    expect(pkg.dependencies["@fontsource/instrument-serif"]).toBeTruthy();
  });

  it("loads no stylesheet or font from a third-party host", () => {
    expect(layout).not.toMatch(/<(?:link|style)[^>]*fonts\.g/i);
    expect(layout).not.toContain("preconnect");
    // The family names the CSS variables promise must still be the ones the
    // packages declare, or the self-hosted files would never be selected.
    expect(globals).toContain('"Plus Jakarta Sans"');
    expect(globals).toContain('"Instrument Serif"');
  });
});

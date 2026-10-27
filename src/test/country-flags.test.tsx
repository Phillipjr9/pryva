import React from "react";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CountryFlag, CountryChips } from "@/components/CountryFlag";
import { COUNTRIES, countryFor, dialCodeFor, flagSrc, hasCountryFlag, regionFlagFor } from "@/lib/countries";

/**
 * Flags are real artwork copied from `flag-icons` (see scripts/copy-flags.mjs).
 * The failure modes worth guarding: a country in the catalogue with no flag file,
 * a region string that silently resolves to the wrong country, and emoji flags
 * creeping back in (they render as "NG" on Windows and as nothing in email).
 */
describe("country flags", () => {
  it("ships a flag file for every country in the catalogue", () => {
    const missing = COUNTRIES.filter((country) => !existsSync(`public${flagSrc(country.code)}`));
    expect(missing.map((c) => `${c.code} (${c.name})`)).toEqual([]);
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(40);
  });

  it("resolves the region strings that actually appear in plan data", () => {
    expect(countryFor("Nigeria")?.code).toBe("ng");
    expect(countryFor("United States")?.code).toBe("us");
    expect(countryFor("US · 30 days")?.code).toBe("us");
    expect(countryFor("Nigeria rental")?.code).toBe("ng");
    expect(countryFor("UK number")?.code).toBe("gb");
    expect(countryFor("europe (38 countries)")).toBeNull();
    expect(regionFlagFor("europe (38 countries)")?.code).toBe("eu");
    expect(countryFor("Africa (12 countries)")).toBeNull();
    expect(countryFor("Global (120+ countries)")).toBeNull();
    expect(countryFor("Any domain")).toBeNull();
    expect(countryFor(null)).toBeNull();
  });

  it("maps regional products to the bloc flag only where one exists", () => {
    expect(regionFlagFor("Europe")?.code).toBe("eu");
    expect(regionFlagFor("Europe (38 countries)")?.code).toBe("eu");
    expect(regionFlagFor("Africa (12 countries)")).toBeNull();
    expect(hasCountryFlag("Europe")).toBe(true);
    expect(hasCountryFlag("Global")).toBe(false);
  });

  it("knows dial codes for the launch markets", () => {
    expect(dialCodeFor("Nigeria")).toBe("+234");
    expect(dialCodeFor("United Kingdom")).toBe("+44");
    expect(dialCodeFor("Global")).toBeNull();
  });

  it("renders the real flag image, with alt text when not decorative", () => {
    const html = renderToStaticMarkup(<CountryFlag region="Nigeria" size={20} />);
    expect(html).toContain('src="/images/flags/ng.svg"');
    expect(html).toContain('alt="Nigeria flag"');
    expect(html).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u); // no emoji flags
  });

  it("falls back to a drawn globe for bundles with no single flag", () => {
    const html = renderToStaticMarkup(<CountryFlag region="Global (120+ countries)" />);
    expect(html).not.toContain("/images/flags/");
    expect(html).toContain("<svg");
    expect(html).toContain('aria-label="Global (120+ countries)"');
  });

  it("renders a chip per country in the coverage strip", () => {
    const html = renderToStaticMarkup(<CountryChips codes={["ng", "us", "gb"]} />);
    expect(html.match(/\/images\/flags\//g)?.length).toBe(3);
    expect(html).toContain("NG");
    expect(html).toContain("US");
    expect(html).toContain("GB");
  });
});

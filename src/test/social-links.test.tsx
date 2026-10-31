import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND_MARKS } from "@/lib/brand-marks";
import { SOCIAL_LINKS, socialHref, socialIsPlaceholder, socialLabel } from "@/lib/social";

const footer = readFileSync("src/components/site/SiteFooter.tsx", "utf8");
const social = readFileSync("src/lib/social.ts", "utf8");

describe("social links", () => {
  it("offers the platforms the owner asked for", () => {
    expect(SOCIAL_LINKS.map((link) => link.id).sort()).toEqual(["tiktok", "x"]);
    expect(SOCIAL_LINKS.map((link) => link.label).sort()).toEqual(["TikTok", "X"]);
  });

  it("only uses brand marks that exist, rather than a hand-drawn logo", () => {
    for (const link of SOCIAL_LINKS) {
      expect(BRAND_MARKS[link.mark], link.mark).toBeDefined();
      expect(BRAND_MARKS[link.mark].body.length).toBeGreaterThan(20);
    }
  });

  it("always has somewhere to go", () => {
    for (const link of SOCIAL_LINKS) {
      const href = socialHref(link);
      expect(href.startsWith("https://"), link.id).toBe(true);
      expect(href).not.toContain("example");
    }
  });

  it("says so when a link is still a placeholder", () => {
    const placeholder = { id: "x" as const, label: "X", mark: "x" as const, profileUrl: null, platformUrl: "https://x.com" };
    const real = { ...placeholder, profileUrl: "https://x.com/pryva" };

    expect(socialIsPlaceholder(placeholder)).toBe(true);
    expect(socialHref(placeholder)).toBe("https://x.com");
    // The label is what a screen reader hears; without it the link claims to be
    // an account that does not exist yet.
    expect(socialLabel(placeholder)).toContain("coming soon");

    expect(socialIsPlaceholder(real)).toBe(false);
    expect(socialHref(real)).toBe("https://x.com/pryva");
    expect(socialLabel(real)).not.toContain("coming soon");
  });

  it("switches to the real profile as soon as one is set, with no other change", () => {
    // The mechanism, not just the current state: setting profileUrl is the whole
    // edit, and the footer already renders through these helpers.
    expect(socialHref({ id: "tiktok", label: "TikTok", mark: "tiktok", profileUrl: "https://www.tiktok.com/@pryva", platformUrl: "https://www.tiktok.com" }))
      .toBe("https://www.tiktok.com/@pryva");
  });

  it("is rendered in the footer with the safety attributes", () => {
    expect(footer).toContain("SOCIAL_LINKS.map");
    expect(footer).toContain("socialHref(link)");
    expect(footer).toContain("socialLabel(link)");
    expect(footer).toContain('target="_blank"');
    // A new tab must not get a handle on this one.
    expect(footer).toContain('rel="noopener noreferrer"');
    expect(footer).toContain("BrandIcon");
  });

  it("documents how to replace a placeholder", () => {
    expect(social).toMatch(/Set `profileUrl`/);
    expect(social).toMatch(/coming soon/);
  });
});

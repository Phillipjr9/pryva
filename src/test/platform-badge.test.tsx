import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PlatformBadge,
  PlatformStrip,
  platformFor,
  platformName,
  type PlatformSlug,
} from "@/components/PlatformBadge";

/**
 * Platform marks replace free-text-only listing titles on /accounts.
 * The important guarantees: detection maps common listing titles to the right
 * platform, every mark is a real drawn SVG (no generated bitmap, no external
 * logo package), and no two platforms render the same shapes.
 */
describe("platform marks", () => {
  it("detects the platform from listing titles and categories", () => {
    expect(platformFor("Facebook aged account 2015")).toBe("facebook");
    expect(platformFor("Instagram 5k followers")).toBe("instagram");
    expect(platformFor("Gmail accounts (PVA)")).toBe("gmail");
    expect(platformFor("Outlook / Hotmail combo")).toBe("outlook");
    expect(platformFor("TikTok creator account")).toBe("tiktok");
    expect(platformFor("Twitter / X account 2012")).toBe("x");
    expect(platformFor("Netflix premium 1 month")).toBe("netflix");
    expect(platformFor("Spotify premium", "Streaming")).toBe("spotify");
    // Category alone is enough when the title is generic.
    expect(platformFor("Premium account", null, "Instagram")).toBe("instagram");
    // Unknown platforms fall back rather than guessing.
    expect(platformFor("LinkedIn recruiter account")).toBe("generic");
    expect(platformFor(null, undefined)).toBe("generic");
  });

  it("renders a drawn svg mark with an accessible name", () => {
    const html = renderToStaticMarkup(<PlatformBadge platform="instagram" />);
    expect(html).toContain("<svg");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Instagram"');
    // Hand-authored geometry, not an <img> pointing at generated art.
    expect(html).not.toContain("<img");
    expect(html).not.toContain(".png");
  });

  it("gives every platform a distinct mark", () => {
    const slugs: PlatformSlug[] = [
      "facebook",
      "instagram",
      "tiktok",
      "gmail",
      "outlook",
      "x",
      "telegram",
      "whatsapp",
      "discord",
      "youtube",
      "netflix",
      "spotify",
      "steam",
    ];

    const shapes = new Set<string>();
    for (const slug of slugs) {
      const html = renderToStaticMarkup(<PlatformBadge platform={slug} />);
      const inner = html.slice(html.indexOf("<svg"), html.lastIndexOf("</svg>"));
      expect(inner.length).toBeGreaterThan(60);
      shapes.add(inner);
      expect(platformName(slug)).not.toBe("Digital account");
    }

    expect(shapes.size).toBe(slugs.length);
  });

  it("renders a trust strip with one mark per platform", () => {
    const html = renderToStaticMarkup(<PlatformStrip platforms={["facebook", "instagram", "gmail"]} />);
    expect(html.match(/role="img"/g)?.length).toBe(3);
    expect(html).toContain("Facebook");
    expect(html).toContain("Instagram");
    expect(html).toContain("Gmail");
  });
});

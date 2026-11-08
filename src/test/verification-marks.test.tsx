import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ServiceCard } from "@/components/dashboard/ServiceExplorer";
import { bitcallOtpItemsForCountry } from "@/lib/services/numbers/otp-catalog";
import { verificationArtwork } from "@/lib/services/numbers/verification-marks";
import type { OtpOffer } from "@/lib/services/numbers/otp-suppliers";

describe("verification listing artwork", () => {
  it("uses verified websites for the named listings in the service grid", () => {
    for (const [name, domain] of Object.entries({
      "25clicks": "25clicks.com", "7Eleven": "7-eleven.com",
      "85C Bakery Cafe": "85cbakerycafe.com", "99Ranch": "99ranch.com",
      "Academy Sports and Outdoors": "academy.com", "Acima": "acima.com",
    })) expect(verificationArtwork(name)).toEqual({ kind: "site-favicon", domain });
  });

  it("matches exact titles in the real pinned icon collection, not substrings or guessed domains", () => {
    expect(verificationArtwork(" Activision ")).toEqual({ kind: "simple-icon", slug: "activision", hex: "000000", version: "16.36.0" });
    for (const name of ["Activision impostor", "51CA", "Example Shopping", "https://example.com/logo.svg", "__proto__", "Verification number"]) {
      expect(verificationArtwork(name)).toEqual({ kind: "service", name: "numbers" });
    }
  });

  it("keeps established branded icons and applies new real artwork without changing offers", () => {
    const apps = ["WhatsApp", "Activision", "85C Bakery Cafe", "unknown"];
    const offers: OtpOffer[] = apps.map((app, i) => ({ supplier: "bitcall", ref: `private-${i}`, app, country: "us", costNgn: 50, stock: 3 }));
    const items = bitcallOtpItemsForCountry(offers, "us", "United States");
    expect(items).toHaveLength(apps.length);
    expect(items.find(i => i.name === "WhatsApp")?.artwork).toEqual({ kind: "brand", name: "whatsapp" });
    expect(items.find(i => i.name === "Activision")?.artwork.kind).toBe("simple-icon");
    expect(items.find(i => i.name === "85C Bakery Cafe")?.artwork.kind).toBe("site-favicon");
    expect(items.find(i => i.name === "unknown")?.artwork.kind).toBe("service");
    expect(items.every(i => i.stock === 3 && i.action !== null)).toBe(true);
    const html = renderToStaticMarkup(<ServiceCard item={items.find(i => i.name === "Activision")!} countryName="United States" />);
    expect(html).toContain("https://cdn.jsdelivr.net/npm/simple-icons@16.36.0/icons/activision.svg");
    expect(html).toContain('referrerPolicy="no-referrer"');
  });
});

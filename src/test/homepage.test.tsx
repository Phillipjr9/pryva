import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => null,
}));

const { default: HomePage, metadata } = await import("@/app/(site)/page");

// Left encoded on purpose: `next=` values carry %2F, and decoding the whole
// document breaks on unrelated percent signs in the markup.
const html = renderToStaticMarkup(await HomePage());

describe("homepage structure", () => {
  it("has exactly one h1 and one main message", () => {
    expect(html.match(/<h1/g)?.length).toBe(1);
    expect(html).toContain("without the friction");
  });

  it("renders all nine services, not the old four", () => {
    for (const name of [
      "Virtual Numbers",
      "eSIM",
      "Residential Proxies",
      "Email OTP",
      "Digital Accounts",
      "Data Plans",
      "Gift Cards",
      "Bulk Orders",
      "Scheduled Purchases",
    ]) {
      expect(html).toContain(name);
    }
    expect(html).not.toContain("Four services");
  });

  it("never sends a signed-out visitor straight at a dashboard route", () => {
    expect(html).not.toContain('href="/dashboard');
    // Dashboard-only services go through sign-in and come back to the right page.
    expect(html).toContain("/login?next=%2Fdashboard%2Fdata");
    expect(html).toContain("In your dashboard");
  });

  it("links the orphaned subscriptions catalogue", () => {
    expect(html).toContain('href="/digital-services"');
    expect(html).toContain("plans, priced in Naira");
  });

  it("shows a real accounts marketplace entry", () => {
    expect(html).toContain("Accounts marketplace");
    expect(html).toContain("Facebook");
    expect(html).toContain("Instagram");
    expect(html).toContain('href="/accounts"');
  });

  it("gives the dashboard section something to look at", () => {
    expect(html).toContain("Auto-refund armed");
    expect(html).toContain("Order PV-2291");
  });
});

describe("homepage promises", () => {
  it("prices the page from the live catalogue, not from typed-in numbers", () => {
    expect(html).toContain("₦1,340"); // Nigeria number
    expect(html).toContain("₦790"); // cheapest inbox
    expect(html).toContain("Wallet top-ups from ₦1,000");
  });

  it("no longer sells subscription tiers that do not exist", () => {
    expect(html).not.toContain("Pryva Plus");
    expect(html).not.toContain("illustrative in this preview");
    expect(html).not.toContain("Most chosen");
  });

  it("does not invent ratings or delivery counts", () => {
    expect(html).not.toContain("4.9/5");
    expect(html).not.toContain("4,200+");
    // The quotes stay, with initials rather than stock portraits.
    expect(html).toContain("Tola A.");
    expect(html).toContain("auto-refund is the part");
  });

  it("keeps the refund promise and payment reassurance", () => {
    expect(html).toContain("Refund promise");
    expect(html).toContain("Payments via Paystack");
    expect(html).toContain('href="/refund-policy"');
  });
});

describe("homepage SEO and navigation", () => {
  it("publishes FAQ structured data", () => {
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain('"@type":"FAQPage"');
  });

  it("anchors the sections that get linked to", () => {
    for (const id of ["services", "accounts", "pricing", "faq", "final-cta"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("sets an Open Graph image so shared links are not bare", () => {
    const og = metadata.openGraph as { images?: { url: string; width: number; height: number }[] };
    expect(og.images?.[0]).toMatchObject({ url: "/og.png", width: 1200, height: 630 });
  });

  it("keeps the sticky phone CTA, which knows when to hide", () => {
    expect(html).toContain("Start with");
    expect(html).toContain("Get started");
  });
});

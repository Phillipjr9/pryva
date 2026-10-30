import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { plansFor } from "@/lib/catalog";
import { isPlanFulfillable } from "@/lib/fulfillment";

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
    expect(html).toContain("Order support");
    expect(html).toContain("Order PV-2291");
  });
});

describe("homepage promises", () => {
  it("prices the page from the live catalogue, not from typed-in numbers", () => {
    expect(html).toContain("₦1,340"); // Nigeria number
    expect(html).toContain("Wallet top-ups from ₦1,000");
  });

  /**
   * The homepage used to advertise ₦790 for a temporary inbox in four separate
   * places: the quick service picker, the service card, the price list, and the
   * sticky phone bar. Email is free now, so a price on it is not merely stale --
   * it asks money for something we have decided to give away.
   *
   * This pins the absence rather than a replacement number, because the failure
   * that matters is a price quietly reappearing: `services` in catalog.ts falls
   * back to a hand-set `fromPrice` whenever a service has no plans, so deleting
   * the email plans alone would have left ₦790 rendering exactly as before.
   */
  it("never puts a price on a temporary inbox", () => {
    expect(html).not.toContain("₦790");
    expect(html).not.toContain("per inbox");
    expect(html).toContain("Free");
  });

  it("no longer sells subscription tiers that do not exist", () => {
    expect(html).not.toContain("Pryva Plus");
    expect(html).not.toContain("illustrative in this preview");
    expect(html).not.toContain("Most chosen");
  });

  it("does not invent ratings or delivery counts", () => {
    expect(html).not.toContain("4.9/5");
    expect(html).not.toContain("4,200+");
    // Do not claim an automatic live refund policy that is currently paused.
    expect(html).not.toContain("Auto-refund armed");
    expect(html).not.toContain("auto-refund is the part");
  });

  it("describes refund review and payment reassurance", () => {
    expect(html).toContain("Refund review");
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

  /**
   * The footer hardcoded `Number fulfillment: Paused` long after numbers became
   * deliverable, so the busiest page on the site said the core product was
   * switched off while /pricing sold ten number plans with working "Get Started"
   * links. The row now derives from the same allowlist /status uses.
   *
   * The expectation is computed here from that allowlist rather than written as a
   * literal, so the test keeps holding when the numbers change -- and so the two
   * cannot drift apart the way a typed-in "Paused" did.
   */
  it("agrees with the fulfilment allowlist about whether numbers are deliverable", () => {
    const numbers = plansFor("numbers");
    const deliverable = numbers.filter((plan) => isPlanFulfillable(plan.slug)).length;
    expect(deliverable, "numbers are deliverable, so this branch is the live one").toBeGreaterThan(0);

    expect(html).toContain(`Automatic · ${deliverable} of ${numbers.length} plans`);
    expect(html).not.toContain("Paused");
  });

  it("keeps the sticky phone CTA, which knows when to hide", () => {
    // The cheapest way onto the site is a free tool now, so the permanent phone
    // bar invites the visitor to start free instead of naming a paid floor.
    expect(html).toContain("Start free");
    expect(html).not.toContain("Start with");
    expect(html).toContain("Get started");
  });
});

/**
 * Its own describe block, and deliberately at the end of the file: an open PR
 * adds a test to "homepage SEO and navigation" above, and two branches inserting
 * at the same anchor conflict for no reason. Placement here keeps both mergeable
 * in either order.
 */
describe("homepage hero", () => {
  /**
   * The hero photo used to carry a fake verification card layered over it --
   * "Example verification / Sample only", a masked +234 number, six digits and
   * an "Expires in 00:19" countdown. It was decoration pretending to be a
   * product screenshot, sitting on the one image a visitor sees first. Removed
   * at the owner's request.
   *
   * Scoped to the hero card's own strings on purpose. The dashboard section
   * further down still shows an illustrative order ("Example Order PV-2291"),
   * because there it is doing real work -- showing what the dashboard looks like
   * -- and it shares wording such as "Nigeria · sample number" with the card
   * that is gone, so a broader assertion would fail for the wrong reason.
   */
  it("keeps the hero photo clean of the fake verification card", () => {
    expect(html).not.toContain("Example verification");
    expect(html).not.toContain("Sample only");
    expect(html).not.toContain("482069");
    // The photo and its call to action stay; only the overlay went.
    expect(html).toContain("Create your account");
  });
});

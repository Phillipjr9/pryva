import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PricingPage from "@/app/(site)/pricing/page";
import { formatNaira, plans } from "@/lib/catalog";
import { isPlanFulfillable } from "@/lib/fulfillment";

/**
 * /pricing is the one surface that advertised plans the app cannot deliver.
 *
 * The fulfilment allowlist is already the single source of truth elsewhere: the
 * plan page offers no way to pay outside it, /api/orders refuses server-side,
 * and fulfillment-safety.test.ts pins that each undeliverable plan fails closed
 * without contacting a provider. This page instead gave all 27 plans a "Get
 * Started" link to /signup?plan=<slug>, so a visitor could be driven to create
 * an account to buy something that could never be delivered.
 *
 * These pin the correction without un-listing anything: the owner's rule is that
 * eSIM and the rest stay visible, so the plans remain with their prices and
 * details, and only the promise to sell is withdrawn -- in the plan page's own
 * existing words.
 */
const NOTE = "This plan cannot be delivered yet, so it cannot be ordered or charged.";
const PRICED_SERVICES = ["numbers", "esim", "proxies", "email-otp"];

const markup = renderToStaticMarkup(<PricingPage />);
const priced = plans.filter((plan) => PRICED_SERVICES.includes(plan.service));
const deliverable = priced.filter((plan) => isPlanFulfillable(plan.slug));
const undeliverable = priced.filter((plan) => !isPlanFulfillable(plan.slug));

function count(needle: string): number {
  return markup.split(needle).length - 1;
}

describe("/pricing only offers to sell what can be delivered", () => {
  it("covers both kinds of plan, so the assertions below are not vacuous", () => {
    expect(priced.length).toBe(27);
    expect(deliverable.length).toBe(10);
    expect(undeliverable.length).toBe(17);
  });

  it("links a signup funnel only for plans that can be delivered", () => {
    for (const plan of deliverable) {
      expect(markup, `${plan.slug} should be offered`).toContain(`/signup?plan=${plan.slug}`);
    }
    for (const plan of undeliverable) {
      expect(markup, `${plan.slug} should not be offered`).not.toContain(`/signup?plan=${plan.slug}`);
    }
  });

  it("says so in the same words the plan page already uses", () => {
    expect(count(NOTE)).toBe(undeliverable.length);
  });

  it("still lists every plan it prices, deliverable or not", () => {
    // One call to action or one honest note per card: gating the link must not
    // silently drop a listing, and a card with neither would be a new state.
    expect(count(NOTE) + count("/signup?plan=")).toBe(priced.length);
    for (const plan of priced) {
      expect(markup, `${plan.slug} should still be listed`).toContain(plan.planLabel);
    }
  });

  it("renders no discount or popularity claim for any plan", () => {
    // catalog.ts deliberately nulls compareAt, popular, badge and highlight on
    // every exported plan because those claims are not backed by verified
    // pricing or usage data, and replaces the feature list with generic lines.
    // The raw definitions still carry them -- email-24 is marked popular,
    // email-bundle claims "Save 48%", email-team claims "20 isolated inboxes"
    // and "Shared team access" -- so this pins that the suppression still holds
    // on the page that would otherwise render them.
    expect(count("line-through")).toBe(0);
    expect(count("Most Popular")).toBe(0);
    expect(markup).not.toContain("Save 48%");
    expect(markup).not.toContain("Save 20%");
    expect(markup).not.toContain("20 isolated inboxes");
    expect(markup).not.toContain("Shared team access");
  });

  it("still shows what an undeliverable plan claims to be, which is why the note matters", () => {
    const team = plans.find((plan) => plan.slug === "email-team");
    expect(team, "email-team should exist in the catalog").toBeDefined();
    // planLabel and duration are NOT suppressed, so this plan still reads as 20
    // inboxes for 30 days, with a price. That is the listing the owner wants
    // kept; the note is what stops it reading as an offer to sell it.
    expect(markup).toContain(team!.planLabel);
    expect(markup).toContain(team!.duration);
    expect(markup).toContain(formatNaira(team!.price));
  });
});

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
 * without contacting a provider. This page instead gave every plan a "Get
 * Started" link to /signup?plan=<slug>, so a visitor could be driven to create
 * an account to buy something that could never be delivered.
 *
 * These pin the correction without un-listing anything: the owner's rule is that
 * eSIM and the rest stay visible, so the plans remain with their prices and
 * details, and only the promise to sell is withdrawn -- in the plan page's own
 * existing words.
 */
const NOTE = "This plan cannot be delivered yet, so it cannot be ordered or charged.";
// email-otp is absent: a temporary inbox is free, so it has no plans to price
// and no group on this page. Pinned explicitly below.
const PRICED_SERVICES = ["numbers", "esim", "proxies"];

const markup = renderToStaticMarkup(<PricingPage />);
const priced = plans.filter((plan) => PRICED_SERVICES.includes(plan.service));
const deliverable = priced.filter((plan) => isPlanFulfillable(plan.slug));
const undeliverable = priced.filter((plan) => !isPlanFulfillable(plan.slug));

function count(needle: string): number {
  return markup.split(needle).length - 1;
}

describe("/pricing only offers to sell what can be delivered", () => {
  it("covers both kinds of plan, so the assertions below are not vacuous", () => {
    expect(priced.length).toBe(23);
    expect(deliverable.length).toBe(10);
    expect(undeliverable.length).toBe(13);
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
    // The raw definitions still carry some of them -- proxy-ng-25 claims a
    // "Scale" badge -- so this pins that the suppression still holds on the page
    // that would otherwise render them. The email tiers that used to carry the
    // loudest claims here ("Save 48%", "20 isolated inboxes") are gone from the
    // catalogue entirely; these assertions stay as a guard against any plan
    // reintroducing them.
    expect(count("line-through")).toBe(0);
    expect(count("Most Popular")).toBe(0);
    expect(markup).not.toContain("Save 48%");
    expect(markup).not.toContain("Save 20%");
    expect(markup).not.toContain("20 isolated inboxes");
    expect(markup).not.toContain("Shared team access");
  });

  it("still shows what an undeliverable plan claims to be, which is why the note matters", () => {
    const scale = plans.find((plan) => plan.slug === "proxy-ng-25");
    expect(scale, "proxy-ng-25 should exist in the catalog").toBeDefined();
    // planLabel and duration are NOT suppressed, so this plan still reads as 25GB
    // in Nigeria for 30 days, with a price. That is the listing the owner wants
    // kept; the note is what stops it reading as an offer to sell it.
    expect(markup).toContain(scale!.planLabel);
    expect(markup).toContain(scale!.duration);
    expect(markup).toContain(formatNaira(scale!.price));
  });

  /**
   * A free tool has no place on a pricing page. /pricing skips any group whose
   * service has no plans, which is what makes this hold without a special case
   * -- but it is worth pinning, because a pricing page that quietly goes on
   * showing an inbox price is precisely the mistake this change exists to fix.
   * The old ₦790 floor came from a hand-set `fromPrice` that survived the
   * deletion of the plans it was derived from.
   */
  it("prices no temporary inbox, because a free tool is not a priced plan", () => {
    expect(plans.filter((plan) => plan.service === "email-otp")).toEqual([]);
    expect(markup).not.toContain("₦790");
    expect(markup).not.toContain("per inbox");
    expect(markup).not.toContain("/signup?plan=email-");
  });
});

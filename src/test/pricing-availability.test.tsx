import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PricingPage from "@/app/(site)/pricing/page";
import { plans } from "@/lib/services/catalog";
import { isPlanFulfillable } from "@/lib/services/fulfillment";

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
const NOTE = "Ordering is unavailable for this plan here; no charge can be made.";
/**
 * With a live catalogue, eSIM sample cards replace the note with a pointer to
 * `/esim`. They are still not sellable -- the link is a signpost, not a sale --
 * so the "one action or one note per card" rule below still holds; only the
 * wording of the eSIM dead end changes.
 */
// eSIM and proxies are live catalogues, not static plan prices. Only number
// plans backed by the local price book are rendered as individual pricing cards.
const PRICED_SERVICES = ["numbers"];

const priced = plans.filter((plan) => PRICED_SERVICES.includes(plan.service));

// Exercise configured paths without contacting providers.
vi.stubEnv("DATABASE_URL", "postgres://mock.invalid/db");
vi.stubEnv("VERCEL_ENV", "production");
vi.stubEnv("BITCALL_KEY_ID", "ak_live_test_only");
vi.stubEnv("BITCALL_API_SECRET", "test-only");
vi.stubEnv("FLEEXA_API_KEY", "test-only");
const markup = renderToStaticMarkup(<PricingPage />);
vi.unstubAllEnvs();
const deliverable = priced.filter((plan) => isPlanFulfillable(plan.slug));
const undeliverable = priced.filter((plan) => !isPlanFulfillable(plan.slug));

afterEach(() => vi.unstubAllEnvs());

function count(needle: string): number {
  return markup.split(needle).length - 1;
}

/**
 * Dead sample cards gain a third element when a live eSIM catalogue exists: a
 * pointer to `/esim`. The card still carries its honest note -- it genuinely has
 * no provider reference and cannot be ordered -- so the one-link-or-one-note
 * invariant below is unaffected.
 */
const LIVE_ESIM_LINK = "/esim";

describe("/pricing only offers to sell what can be delivered", () => {
  it("covers both kinds of plan, so the assertions below are not vacuous", () => {
    expect(priced.length).toBe(12);
    expect(deliverable.length).toBe(10);
    expect(undeliverable.length).toBe(2);
  });

  it("does not offer checkout when supplier ordering is unconfigured", () => {
    vi.stubEnv("DATABASE_URL", "postgres://mock.invalid/db");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BITCALL_KEY_ID", "");
    vi.stubEnv("BITCALL_API_SECRET", "");
    vi.stubEnv("FLEEXA_API_KEY", "");
    const html = renderToStaticMarkup(<PricingPage />);
    for (const plan of priced) expect(html).not.toContain(`/signup?plan=${plan.slug}`);
    expect(html).toContain(NOTE);
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
    const esimDead = undeliverable.filter((plan) => plan.service === "esim").length;
    expect(count(NOTE)).toBe(undeliverable.length);
    // A sample card may point at the live catalogue, but never at a sale.
    if (esimDead > 0) expect(count("/signup?plan=esim-")).toBe(0);
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

  it("routes live proxy pricing to the signed-in shop instead of showing sample prices", () => {
    expect(markup).toContain("Residential Proxies");
    expect(markup).toContain("/login?next=%2Fdashboard%2Fproxies");
    expect(markup).toContain("Current plans and final naira prices load after sign-in");
    expect(markup).not.toContain("25GB · Nigeria");
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

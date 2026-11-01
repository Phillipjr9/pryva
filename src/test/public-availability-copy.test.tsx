import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import ProxiesPage from "@/app/(site)/proxies/page";
import FaqPage from "@/app/(site)/faq/page";
import RefundPolicyPage from "@/app/(site)/refund-policy/page";
import { plans, plansFor } from "@/lib/catalog";
import { isPlanFulfillable } from "@/lib/fulfillment";

/**
 * Public pages may describe what cannot be delivered; they may not offer it.
 *
 * /pricing was corrected to stop promising undeliverable plans. The same promise
 * was still being made elsewhere: /proxies gave every proxy plan a "Get Started"
 * button and a hero signup funnel, and no proxy supplier exists at all. And two
 * FAQ answers plus two refund-policy rows still described eSIM, proxies and
 * airtime as unavailable — one of which has been buyable since the eSIM launch.
 *
 * These assertions are about the promise, not the listing: prices may stay on the
 * page, the words "order" and "charge" may not appear as something you can do.
 */

const NOTE = "This plan cannot be delivered yet, so it cannot be ordered or charged.";

describe("/proxies", () => {
  const markup = renderToStaticMarkup(<ProxiesPage />);
  const proxyPlans = plansFor("proxies");

  it("still lists and prices the proxy plans", () => {
    expect(proxyPlans.length).toBeGreaterThan(0);
    for (const plan of proxyPlans) {
      expect(markup).toContain(plan.name);
    }
  });

  it("offers no way to buy one and says why", () => {
    for (const plan of proxyPlans) {
      expect(isPlanFulfillable(plan.slug), `${plan.slug} must not be sellable`).toBe(false);
      expect(markup, `${plan.slug} must not link to signup`).not.toContain(`/signup?plan=${plan.slug}`);
    }
    expect(markup.split(NOTE).length - 1).toBe(proxyPlans.length);
    expect(markup).toContain("Proxy plans are not available yet");
  });

  it("does not send a visitor to sign up from the hero either", () => {
    // The only signup link in the page body used to be this one.
    expect(markup).not.toContain('href="/signup"');
  });
});

describe("/faq", () => {
  // Answers live inside collapsed accordion items, so they are not in the server
  // markup. The copy is read from the page itself, which is what ships.
  const source = readFileSync(join(process.cwd(), "src/app/(site)/faq/page.tsx"), "utf8");
  it("renders", () => {
    expect(renderToStaticMarkup(<FaqPage />)).toContain("Frequently Asked Questions");
  });

  it("no longer claims eSIM cannot be purchased", () => {
    expect(source).not.toContain("eSIM plans are not available for purchase yet");
    expect(source).toContain("Services → eSIM");
  });

  it("describes what an eSIM does to the customer's number instead of contradicting itself", () => {
    expect(source).toContain("data-only");
  });
});

describe("/refund-policy", () => {
  const markup = renderToStaticMarkup(<RefundPolicyPage />);

  it("does not promise a refund route for services that cannot be ordered", () => {
    expect(markup).not.toContain("eSIM data &amp; residential proxies");
    expect(markup).toContain("Residential proxies");
    expect(markup).toContain("Proxies are not available yet");
    expect(markup).toContain("Airtime and data bundles are not available yet");
  });

  it("keeps the eSIM rule the checkout actually implements", () => {
    expect(markup).toContain("issued before you are charged");
  });
});

describe("the catalogue itself", () => {
  it("has no proxy or eSIM plan in the fulfilment allowlist", () => {
    // If either ever becomes deliverable, the copy assertions above become the
    // wrong ones and this fails first, pointing at them.
    const sellableProxies = plans.filter((plan) => plan.service === "proxies" && isPlanFulfillable(plan.slug));
    expect(sellableProxies).toEqual([]);
  });
});

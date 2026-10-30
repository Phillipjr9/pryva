import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EmailOTPPage from "@/app/(site)/email-otp/page";
import { plans, plansFor } from "@/lib/catalog";

/**
 * This page was the clearest example of a defect the rest of the site had
 * already fixed: it told the visitor "Email OTP plans are not available for
 * purchase yet" and "nothing here can be ordered or charged", then rendered four
 * priced cards (₦790 to ₦13,950) each with a working "Get Started" button
 * routing to `/signup?plan=email-*`. Only /pricing, /status and
 * /virtual-numbers gated their calls to action on the fulfilment allowlist.
 *
 * The tiers are gone now rather than gated, because email is free: there is no
 * plan to allowlist. These tests pin the property that actually matters — the
 * page must not offer to sell something, and must not name a price for it.
 */
const html = renderToStaticMarkup(<EmailOTPPage />);

describe("the free temporary inbox page", () => {
  it("has no paid inbox tiers left to advertise", () => {
    expect(plansFor("email-otp")).toEqual([]);
    for (const slug of ["email-24", "email-30", "email-bundle", "email-team"]) {
      expect(plans.some((plan) => plan.slug === slug), `${slug} should be gone`).toBe(false);
    }
  });

  it("offers nothing to buy and names no price", () => {
    // The old page's whole problem in one line: a signup funnel for a product
    // that could not be delivered, with a price attached.
    expect(html).not.toContain("/signup?plan=");
    expect(html).not.toContain("₦");
    expect(html).not.toContain("Get Started");
    expect(html).not.toContain("View Pricing");
  });

  it("says plainly that the inbox is free", () => {
    expect(html).toContain("free");
    expect(html).toContain("One active inbox at a time");
  });

  it("does not pretend to hand out an inbox before the tool is switched on", () => {
    // Honesty in both directions: no price, and no promise. A visitor should be
    // able to tell that creating an inbox is not possible yet, which is the same
    // standard the eSIM and proxy pages are held to.
    expect(html).toContain("not switched on yet");
    expect(html).toContain("there is no button here to make one");
  });

  it("warns about the mistake that actually costs someone an account", () => {
    // A temporary address that cannot receive a later password reset locks
    // people out for good. This is the one warning worth rendering prominently.
    expect(html).toContain("recover");
    expect(html).toContain("password reset");
  });
});

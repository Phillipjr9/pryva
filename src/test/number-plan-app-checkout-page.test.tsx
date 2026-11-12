import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { findPlan } from "@/lib/services/catalog";

const state = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/identity/auth", () => ({ requireUser: async () => ({ id: "customer", walletBalance: 5000 }) }));
vi.mock("@/lib/services/numbers/otp-catalog", () => ({ findOtpCheckoutOffer: state.resolve }));
vi.mock("@/components/purchase/PlanPurchase", () => ({
  PlanPurchase: ({ nextPath, otpOfferId }: { nextPath: string; otpOfferId: string }) => <p>Return to {nextPath}; selection {otpOfferId}</p>,
}));

import AppOtpCheckoutPage from "@/app/dashboard/services/otp/[offerId]/page";

const id = `otp-${"a".repeat(24)}`;
const plan = findPlan("vn-ng")!;

beforeEach(() => {
  state.resolve.mockReset();
  state.resolve.mockResolvedValue({
    listing: { id, app: "WhatsApp", countryCode: "ng", countryName: "Nigeria", plan, priceNgn: plan.price, purchasable: true },
    errorCode: null,
  });
});

async function page(from?: string | string[], offerId = id, country: string = "ng") {
  return renderToStaticMarkup(await AppOtpCheckoutPage({ params: Promise.resolve({ offerId }), searchParams: Promise.resolve({ country, from }) }));
}

describe("number-plan app checkout navigation", () => {
  it("returns to Number plans with the selected country when reached from that shelf", async () => {
    const html = await page("numbers");
    expect(state.resolve).toHaveBeenCalledWith("ng", id);
    expect(html).toContain("href=\"/dashboard/services?country=ng&amp;category=numbers\"");
    expect(html).toContain("Return to /dashboard/services?country=ng&amp;category=numbers");
    expect(html).toContain(`selection ${id}`);
  });

  it("keeps the original verification return path and rejects untrusted return targets", async () => {
    for (const from of [undefined, "verification", "https://outside.example", ["numbers", "verification"]]) {
      const html = await page(from);
      expect(html).toContain("href=\"/dashboard/services?country=ng&amp;category=verification\"");
      expect(html).not.toContain("outside.example");
    }
  });

  it("preserves the safe return shelf when an app can no longer be confirmed", async () => {
    state.resolve.mockResolvedValue({ listing: null, errorCode: "SERVICE_UNAVAILABLE" });
    const html = await page("numbers");
    expect(html).toContain("href=\"/dashboard/services?country=ng&amp;category=numbers\"");
    expect(html).toContain("cannot be ordered or charged");
    expect(html).not.toContain("selection otp-");
  });

  it("does not resolve an invalid offer or country", async () => {
    const invalidOffer = await page("numbers", "invalid");
    expect(invalidOffer).toContain("href=\"/dashboard/services?country=ng&amp;category=numbers\"");
    const invalidCountry = await page("numbers", id, "xx");
    expect(invalidCountry).toContain("href=\"/dashboard/services\"");
    expect(state.resolve).not.toHaveBeenCalled();
  });
});

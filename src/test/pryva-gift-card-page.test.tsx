// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const auth = vi.hoisted(() => vi.fn(async () => ({ id: "buyer", walletBalance: 2000 })));
vi.mock("@/lib/identity/auth", () => ({ requireUser: auth }));
vi.mock("@/lib/services/gift-cards/brand-readiness", () => ({ legacyBrandGiftCardSalesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import GiftCardsPage from "@/app/dashboard/gift-cards/page";
import BrandGiftCardCheckout from "@/app/dashboard/gift-cards/brand/page";

describe("separate Pryva credit and brand checkout", () => {
  it("shows only Pryva wallet tabs on its separate page", async () => {
    const html = renderToStaticMarkup(await GiftCardsPage());
    expect(auth).toHaveBeenCalledWith("/dashboard/gift-cards");
    expect(html).toContain("Pryva gift cards");
    expect(html).toContain("Send Wallet Credit");
    expect(html).not.toContain("Brand Gift Cards");
    expect(html).toContain("/dashboard/services?category=gift-cards");
  });
  it("opens the selected legacy denomination without a second storefront", async () => {
    const html = renderToStaticMarkup(await BrandGiftCardCheckout({ searchParams: Promise.resolve({ denomination: "steam-usd-10" }) }));
    expect(auth).toHaveBeenCalledWith("/dashboard/gift-cards/brand?denomination=steam-usd-10");
    expect(html).toContain("Steam Wallet Card");
    expect(html).toContain("16,500");
    expect(html).not.toContain("Select Gift Card Brand");
    expect(html).not.toContain("Send Wallet Credit");
  });
  it("rejects unknown denomination ids", async () => {
    const html = renderToStaticMarkup(await BrandGiftCardCheckout({ searchParams: Promise.resolve({ denomination: "bogus" }) }));
    expect(html).toContain("Gift card not found");
  });
});

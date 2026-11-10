// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), blocked: vi.fn(), codes: vi.fn(), topups: vi.fn(), esims: vi.fn(), stars: vi.fn(), legacy: vi.fn(), readiness: vi.fn() }));
vi.mock("@/lib/identity/auth", () => ({ requireUser: mocks.auth }));
vi.mock("@/lib/platform/financial-environment", () => ({ financialActionsUnavailable: mocks.blocked }));
vi.mock("@/lib/services/foxreload/code-orders", () => ({ listedCodeOffers: mocks.codes }));
vi.mock("@/lib/services/foxreload/topup-orders", () => ({ listedTopupOffers: mocks.topups }));
vi.mock("@/lib/services/foxreload/esim-orders", () => ({ listedEsimOffers: mocks.esims }));
vi.mock("@/lib/services/foxreload/stars-orders", () => ({ starsSalesConfigured: mocks.stars }));
vi.mock("@/lib/services/gift-cards/brand-readiness", () => ({ legacyBrandGiftCardSalesEnabled: mocks.legacy }));
vi.mock("@/lib/services/service-readiness", () => ({ readServiceReadiness: mocks.readiness }));
import DashboardServicesPage from "@/app/dashboard/services/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ id: "buyer", walletBalance: 2000 });
  mocks.blocked.mockReturnValue(false); mocks.stars.mockReturnValue(true); mocks.legacy.mockReturnValue(false); mocks.readiness.mockReturnValue([]);
  mocks.codes.mockReturnValue([{ id: "digital-1", name: "Steam Gift Card", region: "US" }]);
  mocks.topups.mockReturnValue([]); mocks.esims.mockReturnValue([]);
});

describe("shared service page", () => {
  it("includes reviewed offers and wallet gift-card management in the hub", async () => {
    const page = await DashboardServicesPage({ searchParams: Promise.resolve({ category: "gift-cards" }) });
    expect(mocks.auth).toHaveBeenCalledWith("/dashboard/services?category=gift-cards");
    expect(page.props.reviewedItems.map((item: { name: string }) => item.name)).toEqual(["Steam Gift Card", "Telegram Stars"]);
    expect(page.props.giftCardManager.props).toMatchObject({ initialTab: "create", brandSalesEnabled: false });
    expect(page.props.initialCategory).toBe("gift-cards");
  });
  it("does not expose reviewed purchases in financially blocked environments", async () => {
    mocks.blocked.mockReturnValue(true);
    const page = await DashboardServicesPage({ searchParams: Promise.resolve({}) });
    expect(page.props.reviewedItems).toEqual([]);
    expect(mocks.codes).not.toHaveBeenCalled();
    expect(mocks.stars).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), blocked: vi.fn(), codes: vi.fn(), topups: vi.fn(), esims: vi.fn(), stars: vi.fn() }));
vi.mock("@/lib/identity/auth", () => ({ requireUser: mocks.auth }));
vi.mock("@/lib/platform/financial-environment", () => ({ financialActionsUnavailable: mocks.blocked }));
vi.mock("@/lib/services/foxreload/code-orders", () => ({ listedCodeOffers: mocks.codes }));
vi.mock("@/lib/services/foxreload/topup-orders", () => ({ listedTopupOffers: mocks.topups }));
vi.mock("@/lib/services/foxreload/esim-orders", () => ({ listedEsimOffers: mocks.esims }));
vi.mock("@/lib/services/foxreload/stars-orders", () => ({ starsSalesConfigured: mocks.stars }));
vi.mock("@/app/dashboard/digital-catalog/DigitalCatalogBrowser", () => ({ DigitalCatalogBrowser: () => <div>Catalogue browser</div> }));
import DigitalCatalogPage from "@/app/dashboard/digital-catalog/page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ id: "user" }); mocks.blocked.mockReturnValue(false);
  mocks.codes.mockReturnValue([{ id: "digital-123", name: "Game", region: "US" }]);
  mocks.topups.mockReturnValue([]); mocks.esims.mockReturnValue([]); mocks.stars.mockReturnValue(true);
});
afterEach(cleanup);
describe("digital catalogue page", () => {
  it("shows enabled reviewed products and their quote links to signed-in users", async () => {
    render(await DigitalCatalogPage());
    expect(mocks.auth).toHaveBeenCalledWith("/dashboard/digital-catalog");
    expect(screen.getByText("Game")).toBeTruthy();
    expect(screen.getByText("Telegram Stars")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Check price and availability" }).map((link) => link.getAttribute("href"))).toEqual(["/dashboard/telegram-stars", "/dashboard/digital-codes?product=digital-123"]);
  });
  it("does not advertise checkout in environments where financial actions are blocked", async () => {
    mocks.blocked.mockReturnValue(true);
    render(await DigitalCatalogPage());
    expect(screen.getByText(/No digital products are currently configured for checkout/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Check price and availability" })).toBeNull();
    expect(mocks.codes).not.toHaveBeenCalled();
    expect(mocks.stars).not.toHaveBeenCalled();
  });
});

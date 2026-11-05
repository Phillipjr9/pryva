// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const readCatalog = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ id: "buyer" }) }));
vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: () => false }));
vi.mock("@/lib/esim-catalog", () => ({
  readEsimCatalog: readCatalog,
  ESIM_CATALOGUE_LIMIT: 1000,
  catalogueItems: (listings: unknown[]) => listings,
}));

import EsimCataloguePage from "@/app/dashboard/esim/page";

const baseStats = {
  returned: 0, priced: 0, skippedNoPlanId: 0, skippedNoPrice: 0, skippedCurrency: 0,
  skippedRate: 0, duplicates: 0, withCoverage: 0, global: 0, purchasable: 0,
};

async function showPage() { return render(await EsimCataloguePage()); }
afterEach(() => { cleanup(); readCatalog.mockReset(); vi.unstubAllEnvs(); });

describe("eSIM catalog page", () => {
  it("shows a real unpriced plan but explains why checkout is disabled", async () => {
    readCatalog.mockResolvedValue({
      offers: [], partial: true, fetchedAt: "2026-11-05T12:00:00Z",
      stats: { ...baseStats, returned: 1, skippedRate: 1 },
      listings: [{ id: "live-esim-aaaaaaaaaaaaaaaaaaaa", name: "Nigeria 1GB", region: "Nigeria", dataLabel: "1GB of data", validityLabel: "7 days", destinations: 1, countrySearch: ["NG", "Nigeria"], global: false, priceNgn: null, purchasable: false }],
    });
    await showPage();
    expect(screen.getByText("Nigeria 1GB")).toBeTruthy();
    expect(screen.getByText("Price unavailable")).toBeTruthy();
    expect(screen.getByText(/no confirmed naira price and cannot be bought/i)).toBeTruthy();
    expect(screen.getByText(/plan list may be incomplete/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Buy eSIM" })).toBeNull();
  });

  it("does not mistake unreadable supplier rows for a filter failure or sold-out inventory", async () => {
    readCatalog.mockResolvedValue({
      offers: [], listings: [], partial: false, fetchedAt: "2026-11-05T12:00:00Z",
      stats: { ...baseStats, returned: 4, skippedNoPlanId: 4 },
    });
    await showPage();
    expect(screen.getByText(/plans were returned, but their details could not be read/i)).toBeTruthy();
    expect(screen.queryByText(/No plan matches that/i)).toBeNull();
  });

  it("distinguishes a failed feed from an empty one", async () => {
    readCatalog.mockRejectedValue(new Error("down"));
    await showPage();
    expect(screen.getByText(/The eSIM catalogue could not be read just now/i)).toBeTruthy();
    expect(screen.queryByText(/No eSIM plan is on sale right now/i)).toBeNull();
  });
});

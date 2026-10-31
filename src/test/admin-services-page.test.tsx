// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * The coverage page.
 *
 * It exists so the owner can see, without reading code, which lanes are selling
 * and delivering, which are configured but unproven, and which refuse money
 * because nothing can deliver them. The states are pinned here rather than left
 * to the implementation.
 */

const state = vi.hoisted(() => ({ results: [] as unknown[][] }));

vi.mock("@/db", () => ({
  db: {
    select: () => {
      const result = state.results.shift() ?? [];
      const chain: Record<string, unknown> = {};
      for (const method of ["from", "where", "groupBy", "orderBy", "limit"]) {
        chain[method] = () => chain;
      }
      chain.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
  },
}));

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1" }) }));
vi.mock("@/lib/fleexa", () => ({ isFleexaConfigured: vi.fn(() => true) }));
vi.mock("@/lib/smm-panel", () => ({ isSmmPanelConfigured: vi.fn(() => true) }));
vi.mock("@/lib/marketplace-policy", () => ({ isMarketplaceCheckoutConfigured: vi.fn(() => false) }));
vi.mock("@/lib/manual-fulfilment", () => ({ isManualFulfilmentReachable: vi.fn(() => true) }));
vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: vi.fn(() => false) }));

import AdminServicesPage from "@/app/admin/services/page";

const recent = new Date(Date.now() - 3_600_000);

function talliesForNumbers(delivered: number) {
  return [
    { provider: "fleexa", status: "delivered", total: delivered, withCode: 0, latest: recent },
  ];
}

beforeEach(() => {
  state.results = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the service coverage page", () => {
  it("reads a lane that delivered recently as delivering", async () => {
    // tallies, then one stale-count query per lane that has providers + a window.
    state.results = [talliesForNumbers(5), [], [], [], []];
    render(await AdminServicesPage());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Service coverage");
    expect(screen.getByText("Virtual numbers & rentals")).toBeTruthy();
    expect(screen.getAllByText("Delivering").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/something reached a customer/i)).toBeTruthy();
  });

  it("says a configured lane has no evidence yet when it has never sold", async () => {
    state.results = [[], [], [], [], []];
    render(await AdminServicesPage());
    expect(screen.getAllByText("Untested").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/nothing has ever been bought/i).length).toBeGreaterThanOrEqual(2);
  });

  it("marks a lane with no credential as not for sale rather than broken", async () => {
    const policy = await import("@/lib/marketplace-policy");
    vi.mocked(policy.isMarketplaceCheckoutConfigured).mockReturnValue(false);
    state.results = [[], [], [], [], []];
    render(await AdminServicesPage());
    expect(screen.getAllByText("Not for sale").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/refuse to take money/i).length).toBeGreaterThanOrEqual(1);
  });

  it("lists what the shop deliberately does not sell, so it is not mistaken for broken", async () => {
    state.results = [[], [], [], [], []];
    render(await AdminServicesPage());
    expect(screen.getByText("Not for sale, on purpose")).toBeTruthy();
    expect(screen.getByText(/eSIM data/)).toBeTruthy();
    expect(screen.getByText(/Mobile data plans/)).toBeTruthy();
  });

  it("states whether the hand-prepared queue can actually be worked", async () => {
    state.results = [[], [], [], [], []];
    render(await AdminServicesPage());
    expect(screen.getByText(/Hand-prepared fulfilment is/)).toBeTruthy();
    expect(screen.getByText("reachable")).toBeTruthy();
  });
});

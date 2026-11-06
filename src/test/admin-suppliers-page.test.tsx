// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ report: null as any }));

vi.mock("@/lib/identity/auth", () => ({ requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1" }) }));
vi.mock("@/lib/admin/supplier-health", () => ({ readSupplierHealth: async () => state.report }));

import AdminSuppliersPage from "@/app/admin/(console)/suppliers/page";

beforeEach(() => {
  state.report = {
    gateway: {
      keyEnvironment: "live",
      balance: { amount: 12.5, currency: "USD", amountNgn: 18750 },
    },
    routing: { order: ["fleexa", "bitcall"], configured: { fleexa: true, bitcall: true } },
    usdToNgn: { rate: 1500, source: "override" },
    destinations: [
      {
        country: "ng",
        name: "Nigeria",
        sellable: true,
        suppliers: [
          { supplier: "fleexa", configured: true, listed: 6, inStock: 2, errorCode: null, cheapestNgn: 700 },
          { supplier: "bitcall", configured: true, listed: 8, inStock: 4, errorCode: null, cheapestNgn: 600 },
        ],
      },
    ],
    plans: [
      {
        slug: "vn-ng",
        name: "Nigeria number",
        country: "ng",
        ourPriceNgn: 1340,
        cheapest: { supplier: "bitcall", costNgn: 600 },
        profitNgn: 740,
        marginPct: 55.2,
        clearsFloor: true,
        blockedBy: null,
      },
    ],
  };
});

afterEach(() => {
  cleanup();
});

describe("the supplier health page", () => {
  it("renders the page heading and the supplier checks", async () => {
    render(await AdminSuppliersPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Supplier health");
    expect(screen.getAllByText("Nigeria").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/bitcall/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/55.2%/i)).toBeTruthy();
    expect(screen.getByText(/live/i)).toBeTruthy();
  });
});

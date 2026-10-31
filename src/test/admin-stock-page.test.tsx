// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * The stock page.
 *
 * It exists so "what can we sell right now" is answerable without reading code or
 * calling an endpoint by hand — including the two states that look like success
 * from the outside: a feed that answered with nothing, and a feed that is up but
 * cannot price what it lists.
 */

const state = vi.hoisted(() => ({ report: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1" }) }));
vi.mock("@/lib/stock-live", () => ({ buildStockReport: async () => state.report }));

import AdminStockPage from "@/app/admin/stock/page";

function report(overrides: Record<string, unknown> = {}) {
  return {
    checkedAt: "2026-10-31T12:00:00.000Z",
    lanes: [
      {
        lane: "numbers",
        label: "Virtual numbers",
        connected: true,
        sellable: 1,
        total: 2,
        error: null,
        lines: [
          { id: "vn-ng", label: "Nigeria number", state: "in-stock", stock: 12, note: "12 units across 1 listing" },
          { id: "vn-gh", label: "Ghana number", state: "no-match", stock: null, note: "the feed lists no number for this destination" },
        ],
      },
      {
        lane: "boosts",
        label: "Boosts",
        connected: false,
        sellable: 0,
        total: 0,
        error: "panel unreachable",
        lines: [],
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("the stock page", () => {
  it("renders each lane with its buyable count", async () => {
    state.report = report();
    render(await AdminStockPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Stock");
    expect(screen.getByText("Virtual numbers")).toBeTruthy();
    expect(screen.getByText("1 of 2 buyable now")).toBeTruthy();
  });

  it("names the feed that did not answer instead of showing an empty lane", async () => {
    state.report = report();
    render(await AdminStockPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/1 feed did not answer/i)).toBeTruthy();
    expect(screen.getAllByText(/panel unreachable/).length).toBeGreaterThan(0);
  });

  it("shows units and the miss reason per line", async () => {
    state.report = report();
    render(await AdminStockPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText(/lists no number for this destination/i)).toBeTruthy();
    expect(screen.getByText("Not listed")).toBeTruthy();
  });

  it("offers a forced re-read of the feeds", async () => {
    state.report = report();
    render(await AdminStockPage({ searchParams: Promise.resolve({}) }));
    const link = screen.getByRole("link", { name: /read the feeds again/i });
    expect(link.getAttribute("href")).toBe("/admin/stock?refresh=1");
  });

  it("says where the same answer is available as JSON", async () => {
    state.report = report();
    render(await AdminStockPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("/api/diagnostics/stock")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("service explorer supplier listings", () => {
  it("waits for a country and labels stock, indicative price and paused ordering", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      ok: true, country: "us", partial: false, fetchedAt: "2026-01-01T12:34:56.000Z", items: [{
        id: "supplier-sms-test", category: "verification", name: "Example supplier app", description: "SMS verification listing", tag: "Other",
        artwork: { kind: "service", name: "numbers" }, source: "supplier", coverage: "catalog-country", stock: 7, myUnits: null, price: 1250, action: null,
      }],
    }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry={null} initialCategory="verification" />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "US" }));
    const card = (await screen.findByRole("heading", { name: "Example supplier app" })).closest("article")!;
    expect(within(card).getByText("Supplier listing")).toBeTruthy();
    expect(within(card).getByText("Supplier-reported region: United States")).toBeTruthy();
    expect(within(card).getByText("Indicative price ₦1,250")).toBeTruthy();
    expect(within(card).getByText("7 left")).toBeTruthy();
    expect(within(card).getByText("Not tracked")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Ordering paused" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Supplier listings are read-only/)).toBeTruthy();
    expect(screen.getByText("2026-01-01 12:34:56 UTC")).toBeTruthy();
  });

  it("never requests the supplier catalog in the public demo", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, simulated: true, country: "us", inventory: {} }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" preview />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/demo/services/inventory");
    expect(fetchMock.mock.calls.every(([url]) => !String(url).startsWith("/api/services/catalog"))).toBe(true);
    expect(screen.getByText(/Demo catalog/)).toBeTruthy();
  });
});

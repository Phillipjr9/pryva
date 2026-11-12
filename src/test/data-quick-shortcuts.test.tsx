// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DataPlansForm } from "@/app/dashboard/data/DataPlansForm";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("offers only reported networks and keeps the network selector and bundle search in sync", async () => {
  const fetchMock = vi.fn(async () => Response.json({
    plans: [
      { id: "mtn", networkCode: "01", network: "MTN", name: "MTN 1GB", publishedAmountKobo: 50000 },
      { id: "glo", networkCode: "02", network: "Glo", name: "Glo 2GB", publishedAmountKobo: 60000 },
    ], checkedAt: "2026-11-12T12:00:00Z", stale: false, checkoutReason: "Checkout is not connected.",
  }));
  vi.stubGlobal("fetch", fetchMock);
  render(<DataPlansForm />);
  const group = await screen.findByRole("group", { name: "Quick network shortcuts" });
  expect(within(group).queryByRole("button", { name: "Airtel" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Search bundles"), { target: { value: "2GB" } });
  fireEvent.click(within(group).getByRole("button", { name: "MTN" }));
  expect(screen.getByRole("combobox", { name: "Network" })).toHaveProperty("value", "01");
  expect(screen.getByLabelText("Search bundles")).toHaveProperty("value", "");
  expect(within(group).getByRole("button", { name: "MTN" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("heading", { name: "MTN 1GB" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Glo 2GB" })).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Checkout is not connected/)).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Network" }), { target: { value: "02" } });
  expect(within(group).getByRole("button", { name: "Glo" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(group).getByRole("button", { name: "All networks" }));
  expect(screen.getByRole("heading", { name: "MTN 1GB" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Glo 2GB" })).toBeTruthy();
});

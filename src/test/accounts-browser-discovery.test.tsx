// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountsBrowser } from "@/app/(site)/accounts/AccountsBrowser";

const response = (data: object) => ({ ok: true, json: async () => data });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("account catalogue discovery", () => {
  it("puts listings and search ahead of hundreds of root product types", async () => {
    const types = Array.from({ length: 150 }, (_, index) => ({ id: index + 1, title: `Product type ${index + 1}`, slug: `type-${index + 1}` }));
    const mock = vi.fn(async (url: string) => {
      if (url.includes("categories")) return response({ configured: true, categories: [{ id: 177, title: "Social", slug: "social" }], subcategories: types });
      return response({ configured: true, listings: [{ id: 1, slug: "p1:123", title: "Instagram account", stock: 12, sold: null, category: "Social", subcategory: "Instagram", priceNgn: 500, warrantyDays: 30, minQuantity: 1, maxQuantity: 12, available: true, fulfilment: "instant", purchasable: true }], meta: { current_page: 1, last_page: 1, per_page: 24, total: 1 } });
    });
    vi.stubGlobal("fetch", mock);
    render(<AccountsBrowser purchaseEnabled />);
    expect(await screen.findByText("Instagram account")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search accounts" })).toBeTruthy();
    expect(screen.queryByText("Product type 1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Social" }));
    expect(await screen.findByRole("button", { name: "Product type 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Product type 9" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 150 types" }));
    expect(screen.getByRole("button", { name: "Product type 150" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All accounts" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Product type 1" })).toBeNull());
    expect(screen.getByText("Instagram account")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AccountsBrowser } from "@/app/(site)/accounts/AccountsBrowser";

const response = (data: object) => ({ ok: true, json: async () => data });
const account = (title: string, id = 1) => ({ id, slug: `p1:${id}`, title, stock: 12, sold: null, category: "Social", subcategory: null, priceNgn: 500, warrantyDays: 30, minQuantity: 1, maxQuantity: 12, available: true, fulfilment: "instant", purchasable: true });
const meta = (total: number, current_page = 1, last_page = 1) => ({ current_page, last_page, per_page: 24, total });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
    expect(await screen.findByText("Instagram account")).toBeTruthy();
  });
  it("searches the complete catalogue by platform and can include sold-out offers", async () => {
    const mock = vi.fn(async (_url: string) => response({ configured: true, listings: [account("Facebook account")], categories: [], meta: meta(1) }));
    vi.stubGlobal("fetch", mock);
    render(<AccountsBrowser purchaseEnabled />);
    await waitFor(() => expect(mock.mock.calls.some(([url]) => String(url).includes("inStock=true"))).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: /^Facebook$/ }));
    await waitFor(() => expect(mock.mock.calls.some(([url]) => String(url).includes("search=Facebook") && String(url).includes("sort=total_price"))).toBe(true));
    fireEvent.click(screen.getByRole("checkbox", { name: "In stock only" }));
    await waitFor(() => {
      const urls = mock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("listings"));
      expect(urls.at(-1)).toContain("search=Facebook");
      expect(urls.at(-1)).not.toContain("inStock=true");
    });
  });

  it("allows a Gmail search even when Gmail is not on the loaded page and retains the stock filter", async () => {
    const mock = vi.fn(async (url: string) => {
      if (url.includes("categories")) return response({ configured: true, categories: [], subcategories: [] });
      const search = new URL(url, "https://test.invalid").searchParams.get("search");
      return response({ configured: true, listings: [account(search === "Gmail" ? "Gmail account" : "Facebook account")], meta: meta(1) });
    });
    vi.stubGlobal("fetch", mock);
    render(<AccountsBrowser purchaseEnabled={false} />);
    expect(await screen.findByText("Facebook account")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gmail" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search accounts" }), { target: { value: "Gmail" } });
    expect(await screen.findByText("Gmail account")).toBeTruthy();
    expect(mock.mock.calls.some(([url]) => String(url).includes("search=Gmail") && String(url).includes("inStock=true"))).toBe(true);
    expect(screen.getByText(/Account purchases are temporarily paused/)).toBeTruthy();
  });

  it("keeps the existing X / Twitter quick search accessible and clears it without changing stock filters", async () => {
    const mock = vi.fn(async (_url: string) => response({ configured: true, listings: [account("X account"), account("Xbox account", 2)], categories: [], meta: meta(2) }));
    vi.stubGlobal("fetch", mock);
    render(<AccountsBrowser purchaseEnabled />);
    const group = await screen.findByRole("group", { name: "Find accounts by platform" });
    const twitter = within(group).getByRole("button", { name: "X / Twitter" });
    expect(within(group).queryByRole("button", { name: "Facebook" })).toBeNull();
    fireEvent.click(twitter);
    expect(twitter.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(mock.mock.calls.some(([url]) => String(url).includes("search=Twitter") && String(url).includes("inStock=true"))).toBe(true));
    fireEvent.click(within(group).getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("searchbox", { name: "Search accounts" })).toHaveProperty("value", "");
    await waitFor(() => expect(screen.getByRole("button", { name: "X / Twitter" }).getAttribute("aria-pressed")).toBe("false"));
    expect(screen.getByRole("checkbox", { name: "In stock only" })).toHaveProperty("checked", true);
  });

  it("does not advertise platform shortcuts when no corresponding listing has been loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ configured: true, listings: [], categories: [], meta: meta(0) })));
    render(<AccountsBrowser purchaseEnabled />);
    expect(await screen.findByText("No accounts match those filters")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Find accounts by platform" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search accounts" }), { target: { value: "missing" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("searchbox", { name: "Search accounts" })).toHaveProperty("value", "");
  });

  it("updates shortcuts as pages change and searches the whole catalogue without losing stock filters", async () => {
    const mock = vi.fn(async (url: string) => {
      if (url.includes("categories")) return response({ configured: true, categories: [], subcategories: [] });
      const params = new URL(url, "https://test.invalid").searchParams;
      const second = params.get("page") === "2" || params.get("search") === "Netflix";
      return response({ configured: true, listings: [account(second ? "Netflix account" : "Facebook account", second ? 2 : 1)], meta: meta(2, second && !params.has("search") ? 2 : 1, 2) });
    });
    vi.stubGlobal("fetch", mock);
    render(<AccountsBrowser purchaseEnabled />);
    expect(await screen.findByRole("button", { name: /^Facebook$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const netflix = await screen.findByRole("button", { name: /^Netflix$/ });
    expect(screen.queryByRole("button", { name: /^Facebook$/ })).toBeNull();
    fireEvent.click(netflix);
    await waitFor(() => expect(mock.mock.calls.some(([url]) => String(url).includes("search=Netflix") && String(url).includes("page=1") && String(url).includes("inStock=true"))).toBe(true));
  });

  it("gives both account reads enough time for a cold shared snapshot", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn(async () => response({ configured: true, categories: [], listings: [] })));
    render(<AccountsBrowser purchaseEnabled />);
    await waitFor(() => expect(timeout.mock.calls.filter(([ms]) => ms === 65_000)).toHaveLength(2));
  });

  it("cancels obsolete listing reads when filters change or the page unmounts", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
      if (url.includes("categories")) return Promise.resolve(response({ configured: true, categories: [] }));
      const signal = init.signal as AbortSignal;
      signals.push(signal);
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    }));
    const view = render(<AccountsBrowser purchaseEnabled />);
    await waitFor(() => expect(signals).toHaveLength(1));
    fireEvent.click(screen.getByRole("checkbox", { name: "In stock only" }));
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
    view.unmount();
    expect(signals[1].aborted).toBe(true);
  });

  it("shows the supplier snapshot time instead of claiming that a reload checked stock now", async () => {
    const checkedAt = "2026-01-01T12:00:00.000Z";
    vi.stubGlobal("fetch", vi.fn(async () => response({ configured: true, categories: [], listings: [], checkedAt })));
    render(<AccountsBrowser purchaseEnabled />);
    const snapshot = await screen.findByText(`Catalogue snapshot from ${new Date(checkedAt).toLocaleString()}. Stock may change; checked again at checkout.`);
    expect(snapshot).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload listings" }));
    await waitFor(() => expect(screen.getByText(`Catalogue snapshot from ${new Date(checkedAt).toLocaleString()}. Stock may change; checked again at checkout.`)).toBeTruthy());
    expect(screen.queryByText(/Stock checked at/)).toBeNull();
  });

});

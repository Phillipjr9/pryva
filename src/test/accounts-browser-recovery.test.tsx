// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AccountsBrowser } from "@/app/(site)/accounts/AccountsBrowser";

const account = (id: number, title: string) => ({ id, slug: `p1:${id}`, title, stock: 8, sold: null, category: "Social", subcategory: null, priceNgn: 500, warrantyDays: 30, minQuantity: 1, maxQuantity: 8, available: true, fulfilment: "instant", purchasable: true });
const meta = { current_page: 1, last_page: 1, per_page: 24, total: 2 };
const article = (name: string) => screen.getByRole("heading", { name }).closest("article")!;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("account catalogue resilience", () => {
  it("keeps valid rows, locks unsafe ones, preserves a failed refresh and recovers", async () => {
    let reads = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("categories")) return Response.json({ configured: true, categories: [{ id: 2, title: "Social", slug: "social" }, { id: 3, title: { bad: true }, slug: "bad" }], subcategories: [] });
      reads++;
      if (reads === 1) return Response.json({ configured: true, listings: [
        account(1, "Facebook account"),
        { ...account(2, "Instagram account"), stock: "many" },
        { ...account(3, "Invalid link"), slug: "javascript:alert(1)" },
        { ...account(4, "Invalid title"), title: { bad: true } },
        null,
      ], meta: { ...meta, total: { bad: true } }, checkedAt: "2026-11-12T12:00:00Z", stale: false });
      if (reads === 2) return Response.json({ error: { private: "not displayable" } }, { status: 500 });
      return Response.json({ configured: true, listings: [account(1, "Facebook account")], meta: { ...meta, total: 1 }, checkedAt: "2026-11-12T12:00:00Z", stale: false });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<AccountsBrowser purchaseEnabled />);
    expect(await screen.findByRole("heading", { name: "Facebook account" })).toBeTruthy();
    expect(screen.getByText(/Some account listings could not be loaded/)).toBeTruthy();
    expect(screen.getByText(/Some categories could not be shown/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Invalid link" })).toBeNull();
    expect(within(article("Instagram account")).getByRole("button", { name: "Paused" })).toHaveProperty("disabled", true);
    fireEvent.click(within(article("Facebook account")).getByRole("button", { name: "Buy" }));
    const dialog = screen.getByRole("dialog", { name: "Buy accounts" });
    expect(within(dialog).getByRole("button", { name: /^Pay/ })).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "Reload listings" }));
    expect(await screen.findByText(/Previously loaded listings remain below/)).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Facebook account" })).toHaveLength(2);
    expect(within(dialog).getByRole("button", { name: /^Pay/ })).toHaveProperty("disabled", true);
    expect(fetcher.mock.calls.some(([url]) => url.includes("/purchase"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(within(article("Facebook account")).getByRole("button", { name: "Buy" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText(/Previously loaded listings remain below/)).toBeNull());
    await waitFor(() => expect(within(article("Facebook account")).getByRole("button", { name: "Buy" })).toHaveProperty("disabled", false));
    expect(screen.queryByText(/Some account listings could not be loaded/)).toBeNull();
    expect(reads).toBe(3);
  });

  it("hides previous-filter rows immediately while the new selection is loading", async () => {
    let reads = 0;
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("categories")) return Promise.resolve(Response.json({ configured: true, categories: [] }));
      if (++reads === 1) return Promise.resolve(Response.json({ configured: true, listings: [account(1, "Facebook account")], meta: { ...meta, total: 1 } }));
      return new Promise<Response>((resolve) => { finish = resolve; });
    }));
    render(<AccountsBrowser purchaseEnabled />);
    expect(await screen.findByRole("heading", { name: "Facebook account" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "In stock only" }));
    expect(screen.queryByRole("heading", { name: "Facebook account" })).toBeNull();
    expect(screen.getByText("Loading listings…")).toBeTruthy();
    await waitFor(() => expect(finish).toBeDefined());
    finish(Response.json({ configured: true, listings: [account(2, "Instagram account")], meta: { ...meta, total: 1 } }));
    expect(await screen.findByRole("heading", { name: "Instagram account" })).toBeTruthy();
  });

  it("hides old search results and locks an open checkout before the debounce finishes", async () => {
    let reads = 0;
    let finish!: (response: Response) => void;
    const fetcher = vi.fn((url: string) => {
      if (url.includes("categories")) return Promise.resolve(Response.json({ configured: true, categories: [] }));
      if (++reads === 1) return Promise.resolve(Response.json({ configured: true, listings: [account(1, "Facebook account")], meta: { ...meta, total: 1 } }));
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<AccountsBrowser purchaseEnabled />);
    expect(await screen.findByRole("heading", { name: "Facebook account" })).toBeTruthy();
    fireEvent.click(within(article("Facebook account")).getByRole("button", { name: "Buy" }));
    const dialog = screen.getByRole("dialog", { name: "Buy accounts" });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search accounts" }), { target: { value: "Instagram" } });
    // Only the old modal heading remains; no stale card can be bought while the
    // 350ms debounce is still pending.
    expect(screen.getAllByRole("heading", { name: "Facebook account" })).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: /^Pay/ })).toHaveProperty("disabled", true);
    expect(screen.getByText("Loading listings…")).toBeTruthy();
    expect(reads).toBe(1);

    await waitFor(() => expect(finish).toBeDefined());
    finish(Response.json({ configured: true, listings: [account(2, "Instagram account")], meta: { ...meta, total: 1 } }));
    expect(await screen.findByRole("heading", { name: "Instagram account" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^Pay/ })).toHaveProperty("disabled", true);
    expect(fetcher.mock.calls.some(([url]) => url.includes("/purchase"))).toBe(false);
  });

  it("does not show old results as matches when a different filter fails", async () => {
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("categories")) return Response.json({ configured: true, categories: [] });
      return ++reads === 1
        ? Response.json({ configured: true, listings: [account(1, "Facebook account")], meta: { ...meta, total: 1 } })
        : Response.json({ error: "Unable to refresh." }, { status: 500 });
    }));
    render(<AccountsBrowser purchaseEnabled />);
    expect(await screen.findByRole("heading", { name: "Facebook account" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "In stock only" }));
    expect(await screen.findByText(/Unable to refresh/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Facebook account" })).toBeNull();
    expect(screen.queryByText(/Previously loaded listings remain below/)).toBeNull();
  });

  it("honours the page-wide checkout gate even if a row claims to be purchasable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("categories")
      ? Response.json({ configured: true, categories: [] })
      : Response.json({ configured: true, listings: [account(1, "Facebook account")], meta: { ...meta, total: 1 } })));
    render(<AccountsBrowser purchaseEnabled={false} />);
    expect(await screen.findByRole("heading", { name: "Facebook account" })).toBeTruthy();
    expect(within(article("Facebook account")).getByRole("button", { name: "Paused" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

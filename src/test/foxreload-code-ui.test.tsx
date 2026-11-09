// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CodePurchase } from "@/app/dashboard/digital-codes/CodePurchase";
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const OFFERS = [{ id: "digital-123", name: "Game key", region: "US" }];
describe("digital code checkout", () => {
  it("requires a quote and shows the exact product, region and price before payment", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => url.endsWith("quote")
      ? { ok: true, json: async () => ({ ok: true, quote: { id: "quote-1", name: "Game key", region: "US", amount: 3255, expiresAt: "2099-01-01T00:00:00Z" } }) }
      : { ok: true, json: async () => ({ ok: true, order: { id: "order-1", reference: "CODE-1", status: "review" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CodePurchase userId="buyer" offers={OFFERS} />);
    fireEvent.click(await screen.findByRole("button", { name: "Get current price" }));
    expect(await screen.findByText(/Game key · US · ₦3,255/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and pay ₦3,255" }));
    expect(await screen.findByText("Delivery not yet confirmed")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ quoteId: "quote-1", requestId: expect.any(String) });
    expect(localStorage.getItem("pryva:code-attempt:buyer")).toContain("quote-1");
    expect(screen.getByRole("link", { name: "View order" }).getAttribute("href")).toBe("/dashboard/orders/order-1");
  });
  it("recovers the original request after a reload even if new sales are disabled", async () => {
    localStorage.setItem("pryva:code-attempt:buyer", JSON.stringify({ quote: { id: "quote-1", name: "Game key", region: "US", amount: 3255 }, requestId: "original-key" }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, order: { id: "order-1", reference: "CODE-1", status: "delivered" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CodePurchase userId="buyer" offers={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Recover purchase" }));
    expect(await screen.findByText("Code ready")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).requestId).toBe("original-key");
    expect(localStorage.getItem("pryva:code-attempt:buyer")).toBeNull();
  });
  it("does not sell unreviewed catalogue products", async () => {
    render(<CodePurchase userId="buyer" offers={[]} />);
    expect(await screen.findByText("No verified products are available to order right now.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Get current price" })).toBeNull();
  });
});

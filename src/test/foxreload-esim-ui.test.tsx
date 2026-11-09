// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EsimPurchase } from "@/app/dashboard/digital-esims/EsimPurchase";
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const OFFERS = [{ id: "digital-123", name: "Travel eSIM", region: "US" }];
describe("digital eSIM checkout", () => {
  it("requires a quote and shows the exact product, region and price before payment", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => url.endsWith("quote")
      ? { ok: true, json: async () => ({ ok: true, quote: { id: "quote-1", name: "Travel eSIM", region: "US", terms: "US only; seven days", amount: 3255, expiresAt: "2099-01-01T00:00:00Z" } }) }
      : { ok: true, json: async () => ({ ok: true, order: { id: "order-1", reference: "CODE-1", status: "review" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EsimPurchase userId="buyer" offers={OFFERS} />);
    fireEvent.click(await screen.findByRole("button", { name: "Get current price" }));
    expect(await screen.findByText(/Travel eSIM · US · ₦3,255/)).toBeTruthy();
    expect(screen.getByText("US only; seven days")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and pay ₦3,255" }));
    expect(await screen.findByText("Delivery not yet confirmed")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ quoteId: "quote-1", requestId: expect.any(String) });
    expect(localStorage.getItem("pryva:fox-esim-attempt:buyer")).toContain("quote-1");
    expect(screen.getByRole("link", { name: "View order" }).getAttribute("href")).toBe("/dashboard/orders/order-1");
  });
  it("recovers the original request after a reload even if new sales are disabled", async () => {
    localStorage.setItem("pryva:fox-esim-attempt:buyer", JSON.stringify({ quote: { id: "quote-1", name: "Travel eSIM", region: "US", amount: 3255 }, requestId: "original-key" }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, order: { id: "order-1", reference: "CODE-1", status: "delivered" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EsimPurchase userId="buyer" offers={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Recover purchase" }));
    expect(await screen.findByText("eSIM ready")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).requestId).toBe("original-key");
    expect(localStorage.getItem("pryva:fox-esim-attempt:buyer")).toBeNull();
  });
  it("preselects a matching approved catalogue product and rejects unknown IDs", async () => {
    const offers = [{ id: "a", name: "First", region: "US" }, { id: "b", name: "Second", region: "US" }];
    const view = render(<EsimPurchase userId="buyer" offers={offers} initialProduct="b" />);
    expect((await screen.findByLabelText("Plan and coverage region") as HTMLSelectElement).value).toBe("b");
    view.unmount();
    render(<EsimPurchase userId="buyer" offers={offers} initialProduct="unapproved" />);
    expect((await screen.findByLabelText("Plan and coverage region") as HTMLSelectElement).value).toBe("");
    expect(screen.getByText(/That product is no longer available/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Get current price" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("does not sell unreviewed catalogue products", async () => {
    render(<EsimPurchase userId="buyer" offers={[]} />);
    expect(await screen.findByText("No verified products are available to order right now.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Get current price" })).toBeNull();
  });
});

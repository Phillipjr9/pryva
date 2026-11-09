// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StarsPurchase } from "@/app/dashboard/telegram-stars/StarsPurchase";

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Telegram Stars purchase UI", () => {
  it("quotes the selected amount, confirms username and sends one stable request", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => url.endsWith("quote")
      ? { ok: true, json: async () => ({ ok: true, quote: { id: "quote-1", quantity: 100, amount: 3255, expiresAt: "2099-01-01T00:00:00Z" } }) }
      : { ok: true, json: async () => ({ ok: true, order: { id: "order-1", reference: "STARS-1", status: "review" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<StarsPurchase userId="buyer" />);
    fireEvent.click(await screen.findByRole("button", { name: "Get current price" }));
    expect(await screen.findByText(/100 Stars · ₦3,255/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Recipient Telegram username"), { target: { value: "@monk_123" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and pay ₦3,255" }));
    expect(await screen.findByText(/Delivery not yet confirmed/)).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ quoteId: "quote-1", username: "monk_123", requestId: expect.any(String) });
    expect(localStorage.getItem("pryva:stars-attempt:buyer")).toContain("quote-1");
    expect(screen.getByRole("link", { name: "View order" }).getAttribute("href")).toBe("/dashboard/orders/order-1");
  });
  it("recovers an uncertain attempt with the original request ID after reload", async () => {
    localStorage.setItem("pryva:stars-attempt:buyer", JSON.stringify({ quote: { id: "quote-1", quantity: 100, amount: 3255 }, username: "monk_123", requestId: "original-key" }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, order: { id: "order-1", reference: "STARS-1", status: "delivered" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<StarsPurchase userId="buyer" />);
    fireEvent.click(await screen.findByRole("button", { name: "Recover purchase" }));
    expect(await screen.findByText("Delivery confirmed")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).requestId).toBe("original-key");
    expect(localStorage.getItem("pryva:stars-attempt:buyer")).toBeNull();
  });
});

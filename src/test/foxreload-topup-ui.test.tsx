// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TopupPurchase } from "@/app/dashboard/digital-topups/TopupPurchase";
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const offers = [{ id: "digital-123", name: "Game top-up", region: "US", min: 1, max: 5 }];
const quote = { id: "quote-1", name: "Game top-up", region: "US", terms: "Only for US accounts.", quantity: 2, amount: 6510, fields: [{ key: "player_id", label: "Player ID" }], expiresAt: "2099-01-01T00:00:00Z" };
describe("direct top-up UI", () => {
  it("shows the recipient and quote before paying, without persisting recipient details", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => url.endsWith("quote")
      ? { ok: true, json: async () => ({ ok: true, quote }) }
      : { ok: true, json: async () => ({ ok: true, order: { id: "order-1", reference: "TOPUP-1", status: "review" } }) });
    vi.stubGlobal("fetch", fetchMock); render(<TopupPurchase userId="buyer" offers={offers} />);
    fireEvent.change(await screen.findByLabelText("Quantity"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Get current price" }));
    expect(await screen.findByText(/Game top-up · US · 2 unit\(s\) · ₦6,510/)).toBeTruthy();
    expect(screen.getByText(/Only for US accounts/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Player ID"), { target: { value: "user123" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and pay ₦6,510" }));
    expect(await screen.findByText("Delivery not yet confirmed")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ quoteId: "quote-1", requestId: expect.any(String), note: { player_id: "user123" } });
    expect(localStorage.getItem("pryva:topup-attempt:buyer")).toContain("quote-1"); expect(localStorage.getItem("pryva:topup-attempt:buyer")).not.toContain("user123");
  });
  it("renders reviewed select and numeric fields and submits typed values without saving them", async () => {
    const typed = { ...quote, fields: [{ key: "uid", label: "User ID", type: "integer" }, { key: "server", label: "Server", type: "select", options: [{ value: "eu", label: "Europe" }] }, { key: "zone_id", label: "Zone", type: "number" }] };
    const fetchMock = vi.fn().mockImplementation(async (url: string) => url.endsWith("quote")
      ? { ok: true, json: async () => ({ ok: true, quote: typed }) }
      : { ok: true, json: async () => ({ ok: true, order: { id: "order-1", reference: "TOPUP-1", status: "review" } }) });
    vi.stubGlobal("fetch", fetchMock); render(<TopupPurchase userId="buyer" offers={offers} />);
    fireEvent.click(await screen.findByRole("button", { name: "Get current price" }));
    fireEvent.change(await screen.findByLabelText("User ID"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("Server"), { target: { value: "eu" } });
    fireEvent.change(screen.getByLabelText("Zone"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and pay ₦6,510" }));
    expect(await screen.findByText("Delivery not yet confirmed")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).note).toEqual({ uid: 123, server: "eu", zone_id: 2.5 });
    expect(localStorage.getItem("pryva:topup-attempt:buyer")).not.toContain('"uid":123');
  });
  it("explains the sign-in and confirmation requirement before buying a login top-up", async () => {
    const loginQuote = { ...quote, deliveryType: "login_topup", fields: [{ key: "login", label: "Account email", type: "email" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, quote: loginQuote }) }));
    render(<TopupPurchase userId="buyer" offers={offers} />);
    fireEvent.click(await screen.findByRole("button", { name: "Get current price" }));
    expect(await screen.findByText(/This service signs in to the account/)).toBeTruthy();
    expect((screen.getByLabelText("Account email") as HTMLInputElement).type).toBe("email");
  });
  it("recovers with the original request and requires the recipient to be re-entered", async () => {
    localStorage.setItem("pryva:topup-attempt:buyer", JSON.stringify({ quote, requestId: "original-key" }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, order: { id: "order-1", reference: "TOPUP-1", status: "delivered" } }) });
    vi.stubGlobal("fetch", fetchMock); render(<TopupPurchase userId="buyer" offers={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Recover purchase" })); expect((await screen.findByRole("alert")).textContent).toContain("Enter all recipient details"); expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Player ID"), { target: { value: "user123" } }); fireEvent.click(screen.getByRole("button", { name: "Recover purchase" }));
    expect(await screen.findByText("Delivery confirmed")).toBeTruthy(); expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ requestId: "original-key", note: { player_id: "user123" } });
    expect(localStorage.getItem("pryva:topup-attempt:buyer")).toBeNull();
  });
  it("preselects only an approved product and its minimum quantity", async () => {
    const options = [...offers, { id: "digital-456", name: "Another top-up", region: "EU", min: 10, max: 50 }];
    render(<TopupPurchase userId="buyer" offers={options} initialProduct="digital-456" />);
    expect((await screen.findByLabelText("Quantity") as HTMLInputElement).value).toBe("10");
    expect((screen.getByDisplayValue("Another top-up — EU") as HTMLSelectElement).value).toBe("digital-456");
  });
  it("shows no offers when nothing has been approved", async () => {
    render(<TopupPurchase userId="buyer" offers={[]} />); expect(await screen.findByText("No verified top-ups are available to order right now.")).toBeTruthy();
  });
});

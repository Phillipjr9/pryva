// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FoxreloadProductReview } from "@/app/admin/(console)/foxreload/FoxreloadProductReview";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("admin account product review", () => {
  it("searches and reads contract details only when requested", async () => {
    const id = `product_${"a".repeat(26)}`;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => url.includes("?q=") ? { ok: true, items: [{ id, name: "Game voucher" }], searchLimited: true } : { ok: true, product: { id, name: "Game voucher", deliveryType: "code", currency: "usd", unitPrice: "2", quantity: 10, minQuantity: 1, maxQuantity: null, countryCode: "US", marketRegion: null, requiredNoteFields: [] } } }));
    vi.stubGlobal("fetch", fetchMock); render(<FoxreloadProductReview />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Search account products"), { target: { value: "Game" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/more may exist/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    expect(await screen.findByText(/Delivery: code; currency: usd; unit price: 2/)).toBeTruthy();
    expect(screen.getByText(/this inspection is not approval to sell/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

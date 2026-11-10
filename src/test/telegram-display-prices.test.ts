import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/lib/services/foxreload/contract";
const mocks = vi.hoisted(() => ({ configured: vi.fn(), rate: vi.fn(), product: vi.fn() }));
vi.mock("@/lib/providers/foxreload", () => ({ isFoxreloadConfigured: mocks.configured, readFoxreloadProductContract: mocks.product }));
vi.mock("@/lib/services/foxreload/exchange-rate", () => ({ foxreloadRate: mocks.rate }));
import { readTelegramDisplayPrices } from "@/lib/services/foxreload/telegram-display-prices";
const base: Product = { id: "product_01kj6xhpn3e29bcw1n69p5mwc5", name: "Telegram Stars 1", currency: "usd", unitPrice: "0.0200", deliveryType: "direct_topup", quantity: 100000, countryCode: null, marketRegion: null, minQuantity: 50, maxQuantity: 100000, requiredNoteFields: ["username"], noteFieldTypes: {}, noteFieldOptions: {} };
beforeEach(() => {
  vi.resetAllMocks(); mocks.configured.mockReturnValue(true); mocks.rate.mockResolvedValue({ value: "1500.0000", source: "live" });
  mocks.product.mockImplementation(async (id: string) => id === base.id ? base : { ...base, id, name: id === "product_01kn1qqhfgekgte4mbtgtc58zp" ? "Telegram Premium 3 Month" : "wrong name", unitPrice: "5.0000", minQuantity: 1, maxQuantity: 1 });
});
describe("Telegram indicative display pricing", () => {
  it("uses live contracts and 40 percent markup without exposing supplier data", async () => {
    const result = await readTelegramDisplayPrices();
    expect(result.stars[0]).toEqual({ quantity: 50, amount: 2100 });
    expect(result.premium).toEqual([{ months: 3, amount: 10500 }, { months: 6, amount: null }, { months: 12, amount: null }]);
    expect(JSON.stringify(result)).not.toMatch(/product_|usd|5\.0000/);
  });
  it("fails closed for unsupported currencies, unsafe fields and missing rates", async () => {
    mocks.product.mockImplementation(async (id: string) => ({ ...base, id, currency: "rub" }));
    let result = await readTelegramDisplayPrices();
    expect(result.stars.every((row) => row.amount === null)).toBe(true);
    expect(result.premium.every((row) => row.amount === null)).toBe(true);
    mocks.rate.mockResolvedValueOnce(null);
    mocks.product.mockClear(); result = await readTelegramDisplayPrices();
    expect(result.stars.every((row) => row.amount === null)).toBe(true);
    expect(mocks.product).not.toHaveBeenCalled();
  });
});

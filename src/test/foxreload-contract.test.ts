import { describe, expect, it } from "vitest";
import { buildOrderItem, decimalUnits, formatDecimalUnits, parseProduct } from "@/lib/services/foxreload/contract";

const stars = {
  id: "product_01kj6xhpn3e29bcw1n69p5mwc5", name: "Telegram Stars", currency: "usd", price: "0.0155",
  deliveryType: "direct_topup", quantity: 9000, orderMinQuantity: 50, orderMaxQuantity: 10000,
  requiredNoteFields: ["username"], noteFieldTypes: { username: "string" }, noteFieldOptions: {},
};

describe("FoxReload product and order contract", () => {
  it("builds Telegram Stars from exact decimal prices, quantity and username", () => {
    const product = parseProduct(stars)!;
    expect(buildOrderItem(product, 1337, { username: "monk" })).toEqual({ itemId: stars.id, quantity: 1337, totalPrice: "20.7235", note: { username: "monk" } });
    expect(buildOrderItem(product, 1, { username: "monk" })).toBeNull();
    expect(buildOrderItem(product, 50, {})).toBeNull();
    expect(buildOrderItem(product, 50, { username: "monk", unexpected: "x" })).toBeNull();
  });
  it("never infers currency, price, delivery type or required fields", () => {
    const product = parseProduct({ id: "one", name: "Subscription" })!;
    expect(product).toMatchObject({ currency: null, unitPrice: null, deliveryType: null, requiredNoteFields: null });
    expect(buildOrderItem(product, 1, {})).toBeNull();
    expect(parseProduct({ ...stars, deliveryType: "new_type" })?.deliveryType).toBeNull();
    expect(parseProduct({ ...stars, price: 0.1 })?.unitPrice).toBeNull();
    expect(parseProduct({ ...stars, orderMaxQuantity: -1 })).toBeNull();
    expect(parseProduct({ ...stars, orderMinQuantity: "1" })).toBeNull();
    expect(parseProduct({ ...stars, quantity: "100" })).toBeNull();
  });
  it("distinguishes region attributes from malformed or missing metadata", () => {
    expect(parseProduct({ ...stars, attributes: { country_code: "US", region: "NA" } })).toMatchObject({ countryCode: "US", marketRegion: "NA" });
    expect(parseProduct({ ...stars, attributes: {} })).toMatchObject({ countryCode: null, marketRegion: null });
    expect(parseProduct({ ...stars, attributes: null })).toMatchObject({ countryCode: undefined, marketRegion: undefined });
    expect(parseProduct({ ...stars, attributes: { country_code: 12, region: [] } })).toMatchObject({ countryCode: undefined, marketRegion: undefined });
  });
  it("handles option fields, precise quantities, and unknown types conservatively", () => {
    const product = parseProduct({ ...stars, requiredNoteFields: ["server"], noteFieldTypes: { server: "select" }, noteFieldOptions: { server: [{ value: "eu", label: "Europe" }] } })!;
    expect(buildOrderItem(product, 50, { server: "eu" })).not.toBeNull();
    expect(buildOrderItem(product, 50, { server: "unknown" })).toBeNull();
    expect(buildOrderItem(product, 50.5, { server: "eu" })).toBeNull();
    expect(buildOrderItem(parseProduct({ ...stars, noteFieldTypes: { username: "new_type" } })!, 50, { username: "monk" })).toBeNull();
  });
  it("builds items for code, eSIM and login-based products without confusing delivery methods", () => {
    for (const deliveryType of ["code", "esim", "login_topup"] as const) {
      const product = parseProduct({ ...stars, deliveryType, requiredNoteFields: [], noteFieldTypes: {}, noteFieldOptions: {} })!;
      expect(product.deliveryType).toBe(deliveryType);
      expect(buildOrderItem(product, 50, {})).toEqual({ itemId: stars.id, quantity: 50, totalPrice: "0.7750" });
    }
  });
  it("validates typed fulfillment fields without assuming missing metadata", () => {
    const product = parseProduct({ ...stars, requiredNoteFields: ["email", "amount"], noteFieldTypes: { email: "email", amount: "integer" }, noteFieldOptions: {} })!;
    expect(buildOrderItem(product, 50, { email: "buyer@example.test", amount: 12 })).not.toBeNull();
    expect(buildOrderItem(product, 50, { email: "bad", amount: 12 })).toBeNull();
    expect(buildOrderItem(product, 50, { email: "buyer@example.test", amount: 12.5 })).toBeNull();
    expect(buildOrderItem(parseProduct({ ...stars, noteFieldOptions: undefined })!, 50, { username: "monk" })).not.toBeNull();
    expect(buildOrderItem(parseProduct({ ...stars, requiredNoteFields: ["server"], noteFieldTypes: { server: "select" }, noteFieldOptions: undefined })!, 50, { server: "eu" })).toBeNull();
  });
  it("refuses generic card issuance because initial amount changes the price", () => {
    expect(buildOrderItem(parseProduct({ ...stars, deliveryType: "banking_card" })!, 50, { username: "monk" })).toBeNull();
    expect(buildOrderItem(parseProduct({ ...stars, deliveryType: "banking_card_topup" })!, 50, { username: "monk" })).toBeNull();
  });
  it("preserves four decimal places without floating point and bounds magnitudes", () => {
    expect(decimalUnits("0.0001")).toBe(BigInt(1));
    expect(formatDecimalUnits(BigInt(207235))).toBe("20.7235");
    expect(decimalUnits("1e4")).toBeNull();
    expect(decimalUnits("-1")).toBeNull();
    expect(decimalUnits("1.12345")).toBeNull();
    expect(decimalUnits("1000000000000")).toBeNull();
  });
});

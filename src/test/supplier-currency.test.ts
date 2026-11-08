import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Supplier currency conversion.
 *
 * Two things here are load-bearing. A catalogue prices hundreds of offers in one
 * currency, so the rate must be looked up once per distinct code and not once per
 * offer — that queue is what used to run after the catalogue read and push it
 * past its deadline. And a currency this deployment cannot convert must produce
 * `null` rather than a guess, because an unconvertible price cannot be sold.
 */

const fx = vi.hoisted(() => ({ usd: vi.fn(), eur: vi.fn() }));

vi.mock("@/lib/payments/exchange-rate", () => {
  // Only the two lookups the catalogue needs; the module has more, and a test
  // that mocked the third would be testing the mock.
  return { getUsdToNgnRate: fx.usd, getFreshNgnRate: fx.eur };
});

const { supplierAmountToNgn, supplierAmountWithRates, supplierCurrencyCode, supplierNgnRates } =
  await import("@/lib/payments/supplier-currency");

const published = new Date().toISOString();

beforeEach(() => {
  fx.usd.mockReset().mockResolvedValue({ rate: 1600, source: "override", fetchedAt: published });
  fx.eur.mockReset().mockResolvedValue({ rate: 1740, source: "live", fetchedAt: published });
});

describe("supplierNgnRates", () => {
  it("looks up each distinct currency once for a whole catalogue", async () => {
    const rates = await supplierNgnRates(["EUR", "eur", "EUR", null, "NGN", "USD"]);

    expect(fx.eur).toHaveBeenCalledTimes(1);
    expect(fx.usd).toHaveBeenCalledTimes(1);
    expect(rates.get("EUR")).toBe(1740);
    expect(rates.get("USD")).toBe(1600);
    // Naira needs no rate at all, and must not trigger a lookup.
    expect(rates.get("NGN")).toBe(1);
  });

  it("carries an unconvertible rate through as null rather than inventing one", async () => {
    fx.eur.mockResolvedValue(null);
    const rates = await supplierNgnRates(["EUR"]);

    expect(rates.get("EUR")).toBeNull();
  });

  it("normalises an amount with no currency to USD", () => {
    expect(supplierCurrencyCode(null)).toBe("USD");
    expect(supplierCurrencyCode("eur")).toBe("EUR");
  });
});

describe("supplierAmountWithRates", () => {
  it("converts with a table that is already resolved", () => {
    const rates = new Map<string, number | null>([["EUR", 1740], ["USD", 1600], ["NGN", 1]]);

    expect(supplierAmountWithRates(0.5, "EUR", rates)).toBe(870);
    expect(supplierAmountWithRates(1, "USD", rates)).toBe(1600);
    expect(supplierAmountWithRates(1340, "NGN", rates)).toBe(1340);
    // A missing currency reads as USD, which is what the marketplace quotes in.
    expect(supplierAmountWithRates(1, null, rates)).toBe(1600);
  });

  it("refuses a price it cannot convert or that is not a price", () => {
    const rates = new Map<string, number | null>([["EUR", null], ["GBP", 2000]]);

    expect(supplierAmountWithRates(1, "EUR", rates)).toBeNull();
    expect(supplierAmountWithRates(1, "JPY", rates)).toBeNull();
    expect(supplierAmountWithRates(0, "NGN", rates)).toBeNull();
    expect(supplierAmountWithRates(-5, "NGN", rates)).toBeNull();
    expect(supplierAmountWithRates(Number.NaN, "NGN", rates)).toBeNull();
    expect(supplierAmountWithRates(null, "NGN", rates)).toBeNull();
  });
});

describe("supplierAmountToNgn", () => {
  it("still converts a single amount for callers that are not listing a catalogue", async () => {
    expect(await supplierAmountToNgn(0.5, "EUR")).toBe(870);
    expect(await supplierAmountToNgn(1340, "NGN")).toBe(1340);
    expect(await supplierAmountToNgn(null, "EUR")).toBeNull();
  });
});

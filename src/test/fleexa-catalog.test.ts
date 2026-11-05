import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplierSnapshot } from "@/lib/services/numbers/fleexa-catalog";

const supplier = vi.hoisted(() => ({
  configured: vi.fn(), sms: vi.fn(), email: vi.fn(), rentals: vi.fn(),
}));
vi.mock("@/lib/providers/fleexa", () => ({
  isFleexaConfigured: supplier.configured,
  listFleexaSmsServices: supplier.sms,
  listFleexaEmailProducts: supplier.email,
  listFleexaRentAreas: supplier.rentals,
}));

const snapshot: SupplierSnapshot = {
  fetchedAt: "2026-01-01T00:00:00Z", partial: false, degraded: null, failedFeeds: [], truncatedFeeds: [],
  sms: [
    { id: "secret-sms-id", name: "WhatsApp", country: "US", priceNgn: 1234, stock: 7 },
    { id: "gb-id", name: "Telegram", country: "GB", priceNgn: 1000, stock: 5 },
    { id: "unknown-id", name: "Unknown", country: null, priceNgn: null, stock: 3 },
    { id: "same-country", name: "Signal", country: "United States", priceNgn: 0.2, stock: -5 },
    { id: "private", name: "Fleexa supplier name", country: "US", priceNgn: 1000, stock: 4 },
    { id: "secret-sms-id", name: "WhatsApp", country: "US", priceNgn: 1234, stock: 7 },
  ],
  email: [{ id: "secret-email-id", name: "Temporary inbox", domain: "mail.test", priceNgn: 2000, stock: 0 }],
  rentals: [
    { id: "secret-rent-id", country: "USA", pricePerMonthNgn: 3000, stock: 2 },
    { id: "no-country", country: null, pricePerMonthNgn: 3000, stock: 2 },
  ],
};

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); supplier.configured.mockReturnValue(true); });

describe("read-only supplier catalog", () => {
  it("shows matching countries and the documented US-only app feed without inventing prices", async () => {
    const { supplierItemsForCountry } = await import("@/lib/services/numbers/fleexa-catalog");
    const items = supplierItemsForCountry(snapshot, "us");
    expect(items.map((item) => item.name)).toEqual(["WhatsApp", "Unknown", "Signal", "Temporary inbox", "Number rental"]);
    expect(items.every((item) => item.source === "live" && item.action === null && item.myUnits === null)).toBe(true);
    expect(items[0]).toMatchObject({ stock: 7, coverage: "catalog-country" });
    expect(items[0].price).toBeGreaterThan(1234);
    expect(items[0]).not.toHaveProperty("priceNgn");
    expect(items[1]).toMatchObject({ stock: 3, price: null, coverage: "catalog-country", action: null });
    expect(items[2]).toMatchObject({ stock: null, price: null });
    expect(items[3]).toMatchObject({ stock: 0, coverage: "not-country-specific" });
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain("secret-sms-id");
    expect(serialized).not.toContain("secret-email-id");
    expect(serialized).not.toContain("secret-rent-id");
    expect(serialized).not.toContain("1234");
    expect(supplierItemsForCountry(snapshot, "not-a-country")).toEqual([]);
    expect(supplierItemsForCountry(snapshot, "gb").map((item) => item.name)).toEqual(["Telegram", "Temporary inbox"]);
    expect(supplierItemsForCountry(snapshot, "ng").some((item) => item.name === "Unknown")).toBe(false);
  });

  it("coalesces requests and reports partial supplier outages without caching user data", async () => {
    supplier.sms.mockResolvedValue(snapshot.sms);
    supplier.email.mockRejectedValue(new Error("offline"));
    supplier.rentals.mockResolvedValue(snapshot.rentals);
    const { readSupplierSnapshot } = await import("@/lib/services/numbers/fleexa-catalog");
    const [first, second] = await Promise.all([readSupplierSnapshot(), readSupplierSnapshot()]);
    expect(first).toEqual(second);
    expect(first.partial).toBe(true);
    expect(first.email).toEqual([]);
    expect(first.failedFeeds).toEqual(["email"]);
    expect(first.truncatedFeeds).toEqual([]);
    expect(supplier.sms).toHaveBeenCalledTimes(1);
    await readSupplierSnapshot();
    expect(supplier.sms).toHaveBeenCalledTimes(1);
    await readSupplierSnapshot(true);
    expect(supplier.sms).toHaveBeenCalledTimes(2);
  });

  it("flags a catalog cap as an incomplete read, not a complete feed", async () => {
    supplier.sms.mockResolvedValue(Array.from({ length: 2001 }, (_, index) => ({ id: String(index), name: "App", country: null, priceNgn: null, stock: 1 })));
    supplier.email.mockResolvedValue([]);
    supplier.rentals.mockResolvedValue([]);
    const { readSupplierSnapshot } = await import("@/lib/services/numbers/fleexa-catalog");
    const result = await readSupplierSnapshot();
    expect(result.sms).toHaveLength(2000);
    expect(result).toMatchObject({ partial: true, degraded: "truncated", failedFeeds: [], truncatedFeeds: ["sms"] });
  });

  it("fails rather than presenting an empty healthy catalog if all endpoints fail", async () => {
    supplier.sms.mockRejectedValue(new Error("down"));
    supplier.email.mockRejectedValue(new Error("down"));
    supplier.rentals.mockRejectedValue(new Error("down"));
    const { readSupplierSnapshot } = await import("@/lib/services/numbers/fleexa-catalog");
    await expect(readSupplierSnapshot()).rejects.toThrow("Supplier catalog unavailable");
  });
});

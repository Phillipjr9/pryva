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
  fetchedAt: "2026-01-01T00:00:00Z", partial: false, degraded: null,
  sms: [
    { id: "secret-sms-id", name: "WhatsApp", country: "US", priceNgn: 1234, stock: 7 },
    { id: "gb-id", name: "Telegram", country: "GB", priceNgn: 1000, stock: 5 },
    { id: "unknown-id", name: "Unknown", country: null, priceNgn: 1000, stock: 3 },
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
  it("shows only explicitly matching countries, hides raw IDs and cost, and preserves unknown counts", async () => {
    const { supplierItemsForCountry } = await import("@/lib/services/numbers/fleexa-catalog");
    const items = supplierItemsForCountry(snapshot, "us");
    expect(items.map((item) => item.name)).toEqual(["WhatsApp", "Signal", "Temporary inbox", "Number rental"]);
    expect(items.every((item) => item.source === "live" && item.action === null && item.myUnits === null)).toBe(true);
    expect(items[0]).toMatchObject({ stock: 7, coverage: "catalog-country" });
    expect(items[0].price).toBeGreaterThan(1234);
    expect(items[0]).not.toHaveProperty("priceNgn");
    expect(items[1]).toMatchObject({ stock: null, price: null });
    expect(items[2]).toMatchObject({ stock: 0, coverage: "not-country-specific" });
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain("secret-sms-id");
    expect(serialized).not.toContain("secret-email-id");
    expect(serialized).not.toContain("secret-rent-id");
    expect(serialized).not.toContain("1234");
    expect(supplierItemsForCountry(snapshot, "not-a-country")).toEqual([]);
    expect(supplierItemsForCountry(snapshot, "gb").map((item) => item.name)).toEqual(["Telegram", "Temporary inbox"]);
  });

  it("uses real provider marks for live inbox listings", async () => {
    const { supplierItemsForCountry } = await import("@/lib/services/numbers/fleexa-catalog");
    const liveEmails = [
      { id: "gmail-1", name: "Gmail inbox", domain: "gmail.com", priceNgn: 750, stock: 8 },
      { id: "outlook-1", name: "Outlook inbox", domain: "outlook.com", priceNgn: 900, stock: 5 },
      { id: "proton-1", name: "Proton Mail inbox", domain: "proton.me", priceNgn: 1100, stock: 3 },
      { id: "mailru-1", name: "Mail.ru inbox", domain: "mail.ru", priceNgn: 650, stock: 2 },
    ];
    const items = supplierItemsForCountry({ ...snapshot, email: liveEmails }, "us").filter((item) => item.category === "email");
    expect(items.map((item) => item.artwork)).toEqual([
      { kind: "brand", name: "gmail" },
      { kind: "brand", name: "outlook" },
      { kind: "brand", name: "protonmail" },
      { kind: "brand", name: "maildotru" },
    ]);
  });

  it("gives every listed inbox its own provider logo, never one shared glyph", async () => {
    // The reported bug: GMX, iCloud, Yandex, Tuta, mail.com, WEB.DE, QQ and Naver
    // all rendered the same envelope, so eight different products looked like one.
    const { supplierItemsForCountry } = await import("@/lib/services/numbers/fleexa-catalog");
    const providers = [
      ["Gmail inbox", "gmail.com", "gmail"],
      ["Outlook inbox", "outlook.com", "outlook"],
      ["Yahoo Mail inbox", "yahoo.com", "yahoo"],
      ["Proton Mail inbox", "proton.me", "protonmail"],
      ["Mail.ru inbox", "mail.ru", "maildotru"],
      ["Zoho Mail inbox", "zoho.com", "zoho"],
      ["GMX inbox", "gmx.com", "gmx"],
      ["iCloud inbox", "icloud.com", "icloud"],
      ["Yandex Mail inbox", "yandex.ru", "yandex"],
      ["Tuta inbox", "tuta.com", "tuta"],
      ["mail.com inbox", "mail.com", "maildotcom"],
      ["WEB.DE inbox", "web.de", "webdotde"],
      ["QQ Mail inbox", "qq.com", "qq"],
      ["Naver Mail inbox", "naver.com", "naver"],
    ] as const;

    const items = supplierItemsForCountry(
      {
        ...snapshot,
        email: providers.map(([name, domain], index) => ({
          id: `e${index}`, name, domain, priceNgn: 500, stock: 4,
        })),
      },
      "us",
    ).filter((item) => item.category === "email");

    expect(items.map((item) => item.artwork)).toEqual(
      providers.map(([, , brand]) => ({ kind: "brand", name: brand })),
    );
    // Fourteen listings, fourteen different marks. This is the assertion the bug
    // would have failed, and it is the owner's actual instruction.
    const marks = new Set(items.map((item) => JSON.stringify(item.artwork)));
    expect(marks.size).toBe(providers.length);
  });

  it("keeps an unidentified inbox off the free tool's glyph and off other providers", async () => {
    const { supplierItemsForCountry } = await import("@/lib/services/numbers/fleexa-catalog");
    const items = supplierItemsForCountry(
      {
        ...snapshot,
        email: [
          { id: "aol-1", name: "AOL inbox", domain: "aol.com", priceNgn: 500, stock: 1 },
          { id: "anon-1", name: "Temporary inbox", domain: "mail.test", priceNgn: 500, stock: 1 },
        ],
      },
      "us",
    ).filter((item) => item.category === "email");

    // Not `email-otp`: that is the Temporary-inbox card's mark, and an unknown
    // provider wearing it is the same duplicate-logo problem one level down.
    expect(items.map((item) => item.artwork)).toEqual([
      { kind: "unidentified-inbox" },
      { kind: "unidentified-inbox" },
    ]);
    expect(items.some((item) => JSON.stringify(item.artwork).includes("email-otp"))).toBe(false);
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
    expect(supplier.sms).toHaveBeenCalledTimes(1);
    await readSupplierSnapshot();
    expect(supplier.sms).toHaveBeenCalledTimes(1);
    await readSupplierSnapshot(true);
    expect(supplier.sms).toHaveBeenCalledTimes(2);
  });

  it("fails rather than presenting an empty healthy catalog if all endpoints fail", async () => {
    supplier.sms.mockRejectedValue(new Error("down"));
    supplier.email.mockRejectedValue(new Error("down"));
    supplier.rentals.mockRejectedValue(new Error("down"));
    const { readSupplierSnapshot } = await import("@/lib/services/numbers/fleexa-catalog");
    await expect(readSupplierSnapshot()).rejects.toThrow("Supplier catalog unavailable");
  });
});

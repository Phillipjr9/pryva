import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/platform/database-config", () => ({ persistentDatabaseConfigured: () => true }));
vi.mock("@/lib/platform/supplier-catalogue-snapshot", () => ({
  supplierCatalogueKey: (family: string) => family,
  readSupplierCatalogue: state.read,
}));
vi.mock("@/lib/providers/fleexa", () => ({
  isFleexaConfigured: () => true,
  listFleexaEmailProducts: vi.fn(),
  listFleexaRentAreas: vi.fn(),
}));

import { readSupplierSnapshot } from "@/lib/services/numbers/fleexa-catalog";

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("shared supplier subfeed recovery", () => {
  it("serves a completed shared email snapshot if the rental snapshot never settles", async () => {
    vi.useFakeTimers();
    const email = [{ id: "one", name: "Gmail", domain: "gmail.com", priceNgn: null, stock: 2 }];
    state.read.mockImplementation((key: string) => key === "fleexa-email"
      ? Promise.resolve({ rows: email, partial: false, degraded: null, fetchedAt: "2026-11-12T10:00:00.000Z" })
      : new Promise(() => {}));
    const pending = readSupplierSnapshot();
    await vi.advanceTimersByTimeAsync(35_001);
    expect(await pending).toEqual({
      email, rentals: [], partial: true, degraded: "outage", fetchedAt: "2026-11-12T10:00:00.000Z",
    });
    state.read.mockImplementation((key: string) => Promise.resolve({ rows: key === "fleexa-email" ? email : [],
      partial: false, degraded: null, fetchedAt: "2026-11-12T10:01:00.000Z" }));
    expect(await readSupplierSnapshot(true)).toMatchObject({ email, rentals: [], partial: false, degraded: null });
  });
});

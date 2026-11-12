import { afterEach, describe, expect, it, vi } from "vitest";
const shared = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform/shared-snapshot", () => ({ readSharedSnapshot: shared }));
import { readSupplierCatalogue, supplierCatalogueKey } from "@/lib/platform/supplier-catalogue-snapshot";
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });
const now = Date.parse("2026-11-11T20:00:00Z");
const value = { rows: [1, 2, 3], partial: false, degraded: null, fetchedAt: new Date(now - 10_000).toISOString() };
describe("shared supplier catalogue policy", () => {
  it("hashes account identity and isolates sources", () => {
    const key = supplierCatalogueKey("boosts", "secret-key");
    expect(key).not.toContain("secret-key");
    expect(key).not.toBe(supplierCatalogueKey("boosts", "other-key"));
    expect(key).not.toBe(supplierCatalogueKey("rentals", "secret-key"));
  });
  it("returns a complete shared snapshot without another supplier read", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    shared.mockResolvedValue({ value, stale: false });
    const refresh = vi.fn();
    expect(await readSupplierCatalogue("test", refresh)).toEqual(value);
    expect(refresh).not.toHaveBeenCalled();
    expect(shared.mock.calls[0][0].ttlMs).toBe(30_000);
  });
  it("preserves stale rows and original timestamp with degradation metadata", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    shared.mockResolvedValue({ value, stale: true });
    expect(await readSupplierCatalogue("test", vi.fn())).toEqual({ ...value, partial: true, degraded: "outage" });
  });
  it.each([NaN, now - 300_001, now + 60_001])("refuses invalid or expired original source time %s", async time => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    shared.mockResolvedValue({ value: { ...value, fetchedAt: Number.isNaN(time) ? "invalid" : new Date(time).toISOString() }, stale: true });
    await expect(readSupplierCatalogue("test", vi.fn())).rejects.toThrow("expired");
  });
  it("does not publish an incomplete refresh over a complete catalogue", async () => {
    shared.mockImplementation(async options => options.refresh());
    await expect(readSupplierCatalogue("test", async () => ({ ...value, partial: true }))).rejects.toThrow("incomplete");
  });
});

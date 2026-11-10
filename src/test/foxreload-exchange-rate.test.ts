import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/payments/exchange-rate", () => ({ getFreshNgnRate: mocks.get }));
import { foxreloadRate } from "@/lib/services/foxreload/exchange-rate";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("FOXRELOAD_USD_NGN_RATE", ""); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("purchase-sensitive digital exchange rate", () => {
  it("prefers a valid explicit rate and never silently substitutes for an invalid override", async () => {
    vi.stubEnv("FOXRELOAD_USD_NGN_RATE", "1500.25");
    expect(await foxreloadRate()).toEqual({ value: "1500.2500", source: "manual" });
    vi.stubEnv("FOXRELOAD_USD_NGN_RATE", "bad");
    expect(await foxreloadRate()).toBeNull(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it("uses a recent reference rate rounded up to four decimal places", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    mocks.get.mockResolvedValue({ rate: 1500.123456, source: "live", fetchedAt: "2026-11-05T11:59:00Z" });
    expect(await foxreloadRate()).toEqual({ value: "1500.1235", source: "live" });
    expect(mocks.get).toHaveBeenCalledWith("USD", { allowOverride: false });
  });
  it("refuses stale, future, invalid, fallback and unavailable rates", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    for (const result of [null, { rate: 1500, source: "override", fetchedAt: "2026-11-05T12:00:00Z" }, { rate: 1500, source: "live", fetchedAt: "2026-11-03T00:00:00Z" }, { rate: 1500, source: "live", fetchedAt: "2026-11-05T12:06:00Z" }, { rate: 100, source: "live", fetchedAt: "2026-11-05T12:00:00Z" }, { rate: NaN, source: "live", fetchedAt: "2026-11-05T12:00:00Z" }]) {
      mocks.get.mockResolvedValueOnce(result); expect(await foxreloadRate()).toBeNull();
    }
    mocks.get.mockRejectedValueOnce(new Error("network down")); expect(await foxreloadRate()).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { holdRemainingMs, withdrawalHoldMs } from "@/lib/withdrawal";

afterEach(() => vi.unstubAllEnvs());

const HOUR = 3_600_000;
const now = Date.now();

describe("withdrawal hold on card-funded balances", () => {
  it("holds a recent card top-up for the full window", () => {
    expect(withdrawalHoldMs()).toBe(48 * HOUR);
    expect(holdRemainingMs(new Date(now - HOUR), now)).toBe(47 * HOUR);
  });

  it("releases once the window has passed", () => {
    expect(holdRemainingMs(new Date(now - 49 * HOUR), now)).toBe(0);
    expect(holdRemainingMs(new Date(now - 48 * HOUR), now)).toBe(0);
  });

  it("does not hold balances that were never card funded", () => {
    expect(holdRemainingMs(null, now)).toBe(0);
    expect(holdRemainingMs(undefined, now)).toBe(0);
  });

  it("accepts a configured window", () => {
    vi.stubEnv("WITHDRAWAL_HOLD_HOURS", "1");
    expect(holdRemainingMs(new Date(now - 30 * 60_000), now)).toBe(30 * 60_000);
    expect(holdRemainingMs(new Date(now - 2 * HOUR), now)).toBe(0);
  });

  it("never lets a bad configuration shorten the hold to zero", () => {
    for (const bad of ["not-a-number", "-5", "1e9", ""]) {
      vi.stubEnv("WITHDRAWAL_HOLD_HOURS", bad);
      expect(withdrawalHoldMs(), `WITHDRAWAL_HOLD_HOURS=${bad}`).toBe(48 * HOUR);
    }
  });

  it("fails closed when a top-up exists but its timestamp cannot be read", () => {
    // Unknown age is not the same as no top-up: an unparseable date must hold
    // rather than release, or a data bug becomes a fraud bypass.
    expect(holdRemainingMs("not-a-date", now)).toBe(48 * HOUR);
    expect(holdRemainingMs(new Date("nonsense"), now)).toBe(48 * HOUR);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DAILY_AMOUNT,
  DEFAULT_DAILY_COUNT,
  VELOCITY_WINDOW_MS,
  assessVelocity,
  velocityLimits,
} from "@/lib/withdrawal-velocity";

/**
 * The daily payout ceiling.
 *
 * The floor and the ceiling are per request; this is the only thing standing
 * between a stolen session and several valid maximum payouts in one minute. It
 * has to be invisible to a real customer and expensive for an attacker, so the
 * boundaries — exactly on the cap, exactly 24 hours old, a returned request —
 * are what matter.
 */
const NOW = new Date("2026-11-02T12:00:00.000Z");
const LIMITS = { maxCount: 3, maxAmountNgn: 1_000_000 };

function request(amount: number, minutesAgo: number, status = "processing") {
  return { amount, status, createdAt: new Date(NOW.getTime() - minutesAgo * 60_000) };
}

afterEach(() => vi.unstubAllEnvs());

describe("assessing a withdrawal against the daily ceiling", () => {
  it("allows an account that has asked for nothing", () => {
    const verdict = assessVelocity([], 50_000, LIMITS, NOW);
    expect(verdict.allowed).toBe(true);
    if (!verdict.allowed) return;
    expect(verdict.usedCount).toBe(0);
    expect(verdict.remainingAmount).toBe(950_000);
  });

  it("counts what has left or is in flight, and nothing else", () => {
    const verdict = assessVelocity(
      [
        request(10_000, 60, "completed"),
        request(10_000, 120, "processing"),
        request(10_000, 180, "rejected"),
        request(10_000, 240, "failed"),
      ],
      1_000,
      LIMITS,
      NOW,
    );
    expect(verdict.allowed).toBe(true);
    if (!verdict.allowed) return;
    expect(verdict.usedCount).toBe(2);
    expect(verdict.usedAmount).toBe(20_000);
  });

  it("ignores anything older than the window, and the boundary is exact", () => {
    const justInside = { amount: 5000, status: "processing", createdAt: new Date(NOW.getTime() - VELOCITY_WINDOW_MS + 1) };
    const exactlyOld = { amount: 900_000, status: "processing", createdAt: new Date(NOW.getTime() - VELOCITY_WINDOW_MS) };

    const verdict = assessVelocity([justInside, exactlyOld], 1000, LIMITS, NOW);
    expect(verdict.allowed).toBe(true);
    if (!verdict.allowed) return;
    expect(verdict.usedCount).toBe(1);
    expect(verdict.usedAmount).toBe(5000);
  });

  it("refuses the request that would exceed the count, and says when it lifts", () => {
    const verdict = assessVelocity(
      [request(1000, 30), request(1000, 60), request(1000, 90)],
      1000,
      LIMITS,
      NOW,
    );
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.reason).toBe("count");
    expect(verdict.message).toContain("3 withdrawal requests in 24 hours");
    // The oldest of the three is the first to age out, 90 minutes ago.
    expect(verdict.retryAt?.toISOString()).toBe(new Date(NOW.getTime() - 90 * 60_000 + VELOCITY_WINDOW_MS).toISOString());
  });

  it("refuses on value even when the count is low, and offers what is left", () => {
    const verdict = assessVelocity([request(900_000, 20)], 200_000, LIMITS, NOW);
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.reason).toBe("amount");
    expect(verdict.usedAmount).toBe(900_000);
    expect(verdict.message).toContain("₦100,000 more right now");
  });

  it("says nothing is left when the ceiling is already reached", () => {
    const verdict = assessVelocity([request(1_000_000, 20)], 1_000, LIMITS, NOW);
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.message).not.toContain("more right now");
    expect(verdict.message).toContain("after");
  });

  it("allows a request that lands exactly on the ceiling", () => {
    const verdict = assessVelocity([request(500_000, 20), request(500_000, 40)], 1_000, LIMITS, NOW);
    // Count is 2 of 3, value is exactly on the cap only if nothing more is added,
    // so a further ₦1,000 is over the line while ₦0 would be inside it.
    expect(verdict.allowed).toBe(false);
    const exact = assessVelocity([request(500_000, 20), request(499_000, 40)], 1_000, LIMITS, NOW);
    expect(exact.allowed).toBe(true);
  });

  it("handles the degenerate single-request limit without dividing by zero", () => {
    const verdict = assessVelocity([], 1000, { maxCount: 1, maxAmountNgn: 1_000_000 }, NOW);
    expect(verdict.allowed).toBe(true);
    if (!verdict.allowed) return;
    expect(verdict.remainingCount).toBe(0);
  });
});

describe("reading the limits from the deployment", () => {
  it("uses the owner's numbers by default", () => {
    expect(velocityLimits()).toEqual({ maxCount: DEFAULT_DAILY_COUNT, maxAmountNgn: DEFAULT_DAILY_AMOUNT });
    expect(DEFAULT_DAILY_COUNT).toBe(3);
    expect(DEFAULT_DAILY_AMOUNT).toBe(1_000_000);
  });

  it("accepts a stricter deployment setting", () => {
    vi.stubEnv("WITHDRAWAL_DAILY_COUNT_LIMIT", "1");
    vi.stubEnv("WITHDRAWAL_DAILY_AMOUNT_LIMIT", "25000");
    expect(velocityLimits()).toEqual({ maxCount: 1, maxAmountNgn: 25_000 });
  });

  it("falls back to the default rather than to unlimited when a value is nonsense", () => {
    for (const bad of ["", "0", "-5", "three", "1e999", "  "]) {
      vi.stubEnv("WITHDRAWAL_DAILY_COUNT_LIMIT", bad);
      vi.stubEnv("WITHDRAWAL_DAILY_AMOUNT_LIMIT", bad);
      expect(velocityLimits(), bad).toEqual({ maxCount: DEFAULT_DAILY_COUNT, maxAmountNgn: DEFAULT_DAILY_AMOUNT });
    }
  });
});

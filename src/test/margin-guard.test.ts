import { afterEach, describe, expect, it, vi } from "vitest";
import { checkMargin, MARGIN_BLOCKED_MESSAGE } from "@/lib/margin-guard";

afterEach(() => vi.unstubAllEnvs());

describe("margin guard", () => {
  it("allows a sale that clears the floor", () => {
    expect(checkMargin(1200, 600)).toMatchObject({ ok: true, marginNgn: 600 });
  });

  it("refuses a sale that loses money", () => {
    expect(checkMargin(1200, 1500)).toMatchObject({ ok: false, code: "UNPROFITABLE", marginNgn: -300 });
  });

  it("refuses a margin below the floor even though it is still positive", () => {
    // 5% gross margin on a ₦1,200 sale does not survive payment processing.
    expect(checkMargin(1200, 1140)).toMatchObject({ ok: false, code: "UNPROFITABLE", marginNgn: 60 });
  });

  it("honours a configured floor, and ignores an unsafe one", () => {
    vi.stubEnv("MIN_MARGIN_RATIO", "0.4");
    expect(checkMargin(1200, 800)).toMatchObject({ ok: false, code: "UNPROFITABLE" });
    expect(checkMargin(1200, 600)).toMatchObject({ ok: true });

    // A malformed value must never widen what is allowed to sell.
    vi.stubEnv("MIN_MARGIN_RATIO", "not-a-number");
    expect(checkMargin(1200, 1140)).toMatchObject({ ok: false, code: "UNPROFITABLE" });
    vi.stubEnv("MIN_MARGIN_RATIO", "5");
    expect(checkMargin(1200, 1140)).toMatchObject({ ok: false, code: "UNPROFITABLE" });
  });

  it("refuses to buy when the provider reports no price", () => {
    expect(checkMargin(1200, null)).toMatchObject({ ok: false, code: "COST_UNKNOWN" });
    expect(checkMargin(1200, 0)).toMatchObject({ ok: false, code: "COST_UNKNOWN" });
    expect(checkMargin(1200, Number.NaN)).toMatchObject({ ok: false, code: "COST_UNKNOWN" });
    expect(checkMargin(1200, -1)).toMatchObject({ ok: false, code: "COST_UNKNOWN" });
  });

  it("refuses a nonsensical selling price rather than dividing by it", () => {
    expect(checkMargin(0, 100)).toMatchObject({ ok: false, code: "COST_UNKNOWN" });
    expect(checkMargin(-5, 100)).toMatchObject({ ok: false, code: "COST_UNKNOWN" });
    expect(checkMargin(1.5, 1)).toMatchObject({ ok: false, code: "COST_UNKNOWN" });
  });

  it("never puts wholesale figures into the customer-facing message", () => {
    // Cost is supplier information. If a figure ever reached this string it would
    // be rendered to a customer by the purchase route.
    expect(MARGIN_BLOCKED_MESSAGE).not.toMatch(/[0-9₦$]/);
    expect(MARGIN_BLOCKED_MESSAGE.toLowerCase()).not.toMatch(/cost|margin|wholesale|supplier|fleexa/);
  });
});

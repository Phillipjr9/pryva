import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOT_FOR_SALE,
  SERVICE_LANES,
  summariseLane,
  type OrderTally,
} from "@/lib/services/service-coverage";

/**
 * "The eSIM listing is empty" has to be answerable from the console.
 *
 * Two defects made it unanswerable, and both looked healthy from the outside:
 *
 *   1. The coverage page asserted under "Not for sale, on purpose" that eSIM had
 *      no order path and an unmounted purchase endpoint. Both were false — the
 *      route is mounted and eSIM orders are written by it — so the one page an
 *      operator checks for "is this lane broken?" contradicted the storefront.
 *   2. eSIM and virtual numbers share `orders.provider` ("bitcall"), so an eSIM
 *      order was counted as a number. A lane built on provider alone would have
 *      read "configured, but nothing has ever been bought" even while eSIM was
 *      selling, which is the same lie in a different column.
 *
 * These assertions pin the fix on the data shape, not on the rendered copy.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

const esimLane = SERVICE_LANES.find((lane) => lane.id === "esim");

function tally(overrides: Partial<OrderTally> = {}): OrderTally {
  return {
    provider: "bitcall",
    service: "esim",
    status: "delivered",
    total: 1,
    withCode: 0,
    latest: new Date(),
    ...overrides,
  };
}

describe("eSIM is a lane the console is accountable for", () => {
  it("is not listed as something the shop refuses to sell", () => {
    // The purchase route exists at src/app/api/esim/purchase/route.ts and writes
    // an order. Claiming otherwise is the bug, not an opinion.
    expect(read("app/api/esim/purchase/route.ts")).toContain("orders");
    expect(NOT_FOR_SALE.map((entry) => entry.label)).not.toContain("eSIM data");
  });

  it("has a lane of its own, with a delivery and recovery story", () => {
    expect(esimLane).toBeDefined();
    expect(esimLane?.label).toBe("eSIM data");
    expect(esimLane?.delivery).toMatch(/activation code/i);
    expect(esimLane?.recovery).toMatch(/refund|review/i);
  });

  it("claims the shared gateway without claiming every one of its orders", () => {
    // eSIM is bought through the same gateway that sells numbers.
    expect(esimLane?.providers).toContain("bitcall");
    expect(esimLane?.services).toEqual(["esim"]);
  });

  it("does not count a number order as an eSIM delivery", () => {
    const lane = summariseLane({
      spec: esimLane!,
      tallies: [tally({ service: "numbers", status: "delivered", total: 40 })],
      stale: 0,
      configured: true,
    });
    expect(lane.orders).toBe(0);
    expect(lane.verdict).toBe("untested");
  });

  it("does not let a number order make an eSIM lane look like it is delivering", () => {
    const lane = summariseLane({
      spec: esimLane!,
      tallies: [
        tally({ service: "numbers", status: "delivered", total: 12 }),
        tally({ service: "esim", status: "delivered", total: 3 }),
      ],
      stale: 0,
      configured: true,
    });
    expect(lane.orders).toBe(3);
    expect(lane.delivered).toBe(3);
    expect(lane.verdict).toBe("delivering");
  });

  it("reads as closed, not as untested, when the gateway key is absent", () => {
    // "Untested" would send an operator looking for a bug in the order path when
    // the real answer is that a credential is missing.
    const lane = summariseLane({
      spec: esimLane!,
      tallies: [],
      stale: 0,
      configured: false,
    });
    expect(lane.verdict).toBe("unavailable");
  });

  it("treats the gateway key as the gate, on the page as well as in the lane", () => {
    const page = read("app/admin/(console)/services/page.tsx");
    expect(page).toContain("isBitcallConfigured");
    // Whitespace-normalised so a comment added inside the case does not fail it.
    const compressed = page.replace(/\s+/g, " ");
    expect(compressed).toContain('case "esim":');
    expect(compressed).toMatch(/case "esim":[^}]*return isBitcallConfigured\(\)/);
  });

  it("filters the stuck-order sweep by service too", () => {
    // An unfiltered sweep would report eSIM orders as stuck in the numbers lane
    // and vice versa, which sends someone to the wrong queue.
    const page = read("app/admin/(console)/services/page.tsx");
    expect(page).toContain("inArray(orders.service, lane.services)");
  });
});

describe("an empty storefront says which kind of empty it is", () => {
  it("does not dress an empty catalogue up as a failed search", () => {
    // The list component's zero state offers "Clear filters" when filters match
    // nothing. Reusing it for zero plans told a customer their search was at
    // fault when no filters were ever applied -- and gave "the listing is empty"
    // as the only bug report available.
    const page = read("app/dashboard/esim/page.tsx");
    expect(page).toContain("No eSIM plan is on sale right now.");
    expect(page).toMatch(/total === 0/);
  });

  it("distinguishes a supplier outage from not being connected at all", () => {
    const page = read("app/dashboard/esim/page.tsx");
    expect(page).toContain("eSIM ordering is not connected yet");
    expect(page).toContain("The eSIM catalogue could not be read just now.");
  });
});

describe("an unreadable supplier schema is loud, not empty", () => {
  it("reports rows that were all discarded instead of returning an empty list", () => {
    // A supplier that renames `planId` makes every row unreadable. The read still
    // succeeds, so nothing throws: the storefront simply lists nothing and the
    // health check stays green. That is the bug report "the listing is empty".
    const client = read("lib/providers/bitcall.ts");
    expect(client).toContain("eSIM catalog returned rows but none were readable");
    expect(client).toContain("eSIM catalog rows skipped");
    // Only key *names* are logged -- never a plan reference, never a price.
    expect(client).toMatch(/sampleKeys = Object\.keys\(row\)\.slice\(0, 12\)/);
    expect(client).not.toMatch(/logger\.(warn|error)\("eSIM[^"]*",\s*\{\s*planId/);
  });
});

describe("the public eSIM page agrees with itself", () => {
  it("does not advertise 'live plans' and 'not available yet' at once", () => {
    // The hero and the sample cards already swap with the supplier key; the
    // written highlights and FAQ did not. With the key set, the page read
    // "Live eSIM data plans … the moment you buy" and then, in bold, "eSIM plans
    // cannot be delivered yet, so nothing here can be ordered or charged" —
    // which is exactly how an owner concludes eSIM is switched off.
    const page = read("app/(site)/esim/page.tsx");
    expect(page).toContain("const highlights = live");
    expect(page).toContain("const faqs = live");
    expect(page).toContain("Check current plans");
    // The pre-launch strings must survive for the no-supplier case.
    expect(read("lib/services/catalog.ts")).toContain("not available for purchase yet");
  });
});

describe("no public page says eSIM cannot be bought while it is being bought", () => {
  it("reports the category as orderable once a live catalogue exists", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://configured.test/database");
    vi.stubEnv("BITCALL_KEY_ID", "ak_live_abc");
    vi.stubEnv("BITCALL_API_SECRET", "a".repeat(128));
    const { esimCategoryOrderable } = await import("@/lib/services/esim/esim-availability");
    expect(esimCategoryOrderable()).toBe(true);

    vi.resetModules();
    vi.stubEnv("BITCALL_KEY_ID", "");
    vi.stubEnv("BITCALL_API_SECRET", "");
    const off = await import("@/lib/services/esim/esim-availability");
    expect(off.esimCategoryOrderable()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("is not a licence to sell a sample card", () => {
    // The six written cards have no provider reference: `FULFILMENT_MAP` omits
    // them, /api/orders refuses them, and no page may offer one. Availability is a
    // report about a category, never a permission for a plan -- an earlier
    // revision of this change made /pricing link a signup funnel for all six and
    // the plan page render a purchase button that the API would reject.
    const pricing = read("app/(site)/pricing/page.tsx");
    expect(pricing).toContain("const deliverable = isPlanFulfillable(plan.slug);");
    expect(pricing).not.toContain("catalogEsimSampleIsSellable(plan.slug)");

    const planPage = read("app/dashboard/services/plan/[slug]/page.tsx");
    expect(planPage).toContain("const fulfillable = isPlanFulfillable(plan.slug);");
    expect(planPage).not.toContain("esimCategoryOrderable");
  });

  it("points to the live eSIM catalogue without showing dead sample cards", () => {
    // The card keeps its note -- it genuinely cannot be ordered -- but "cannot be
    // delivered yet" alone reads as a broken product while the dashboard sells
    // eSIM, so it points at the live catalogue.
    const pricing = read("app/(site)/pricing/page.tsx");
    expect(pricing).toContain("isEsimOrderingAvailable()");
    expect(pricing).toContain('href="/dashboard/esim"');
    expect(pricing).not.toContain("Example only");
  });
});

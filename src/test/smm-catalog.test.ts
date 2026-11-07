import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SmmService } from "@/lib/providers/smm-panel";
import type { BoostSnapshot } from "@/lib/services/boosts/smm-catalog";

const panel = vi.hoisted(() => ({
  configured: vi.fn(), services: vi.fn(), balance: vi.fn(), urlSetting: vi.fn(),
}));
vi.mock("@/lib/providers/smm-panel", () => ({
  isSmmPanelConfigured: panel.configured,
  listSmmServices: panel.services,
  getSmmBalance: panel.balance,
  smmPanelApiUrlSetting: panel.urlSetting,
}));

function service(overrides: Partial<SmmService> = {}): SmmService {
  return {
    // A sellable default: naira-billed, priced, on a platform the hub lists. Tests
    // that need a USD panel or an unusable service override it explicitly.
    id: "svc-101", name: "Instagram Followers", category: "Instagram - Followers", type: "Default",
    ratePer1000: 1_500, currency: "NGN", min: 100, max: 10_000_000,
    refill: true, cancel: true, dripfeed: false,
    ...overrides,
  };
}

function snapshot(services: SmmService[]): BoostSnapshot {
  return { services, currency: "USD", balance: 177.69, partial: false, degraded: null, balanceUnavailable: false, fetchedAt: "2026-01-01T00:00:00Z" };
}

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  panel.configured.mockReturnValue(true);
  // A panel brand that must never reach a customer.
  panel.urlSetting.mockReturnValue("https://cheapfollows.test/api/v2");
});

describe("boosting catalog listings", () => {
  it("lists nothing from a USD panel until a naira rate exists", async () => {
    const { boostItems } = await import("@/lib/services/boosts/smm-catalog");
    const usdPanel = service({ currency: "USD", ratePer1000: 0.74, min: 10 });

    // No rate means no defensible retail price. Rather than a shop full of cards
    // that cannot be bought, the hub lists nothing and the admin checklist says
    // why — inventing an exchange rate is how a platform sells below cost.
    delete process.env.SMM_USD_NGN_RATE;
    expect(boostItems(snapshot([usdPanel]))).toHaveLength(0);

    // With a rate the same service becomes a real listing: 0.74 USD per 1,000 at
    // ₦1,600 and a 35% margin is ₦1,598.40 per 1,000, and the panel's smallest
    // order is 10 units.
    process.env.SMM_USD_NGN_RATE = "1600";
    try {
      const priced = boostItems(snapshot([usdPanel]))[0];
      expect(priced.price).toBe(16); // ceil(1598.4 * 10 / 1000)
      expect(priced.priceFrom).toBe(true);
      expect(priced.action).toEqual({ label: "Buy boost", href: `/dashboard/services/boost/${priced.id}` });
      expect(priced.stock).toBeNull();
    } finally {
      delete process.env.SMM_USD_NGN_RATE;
    }
  });

  it("readies an NGN-billed service without any exchange rate", async () => {
    const { boostItems } = await import("@/lib/services/boosts/smm-catalog");
    process.env.SMM_MARKUP_PERCENT = "50";
    try {
      const [item] = boostItems(snapshot([service({ ratePer1000: 1000, currency: "NGN", min: 1000 })]));
      // ₦1,000 per 1,000 wholesale, 50% margin, 1,000 units.
      expect(item.price).toBe(1500);
      expect(item.action?.label).toBe("Buy boost");
    } finally {
      delete process.env.SMM_MARKUP_PERCENT;
    }
  });

  it("hides the panel's service identifiers and wholesale rate", async () => {
    const { boostItems } = await import("@/lib/services/boosts/smm-catalog");
    const serialized = JSON.stringify(boostItems(snapshot([service({ id: "svc-secret-999", ratePer1000: 1_500 })])));
    expect(serialized).not.toContain("svc-secret-999");
    // The retail total for the smallest order (100 units at ₦2,025/1,000 = ₦203)
    // is what ships; the wholesale rate per thousand is not.
    expect(serialized).not.toContain("1500");
    expect(serialized).toContain('"price":203');
    expect(serialized).not.toContain("177.69");
    expect(boostItems(snapshot([service()]))[0].id).toMatch(/^live-boost-[0-9a-f]{20}$/);
  });

  it("collapses the emoji and newlines panels decorate names with", async () => {
    const { boostItems } = await import("@/lib/services/boosts/smm-catalog");
    const decorated = service({ name: "\u26a1 TikTok Views\n\n\ud83d\udfe2 Fast start \u267b\ufe0f Refill 30 days" });
    const [item] = boostItems(snapshot([decorated]));
    expect(item.name).toBe("TikTok Views Fast start Refill 30 days");
    expect(item.tag).toBe("Views");
    expect(item.name).not.toMatch(/[\u0000-\u001f\u007f]/);
  });

  it("never reveals the panel's name or that stock is bought in", async () => {
    const { boostItems } = await import("@/lib/services/boosts/smm-catalog");
    const tainted = [
      service({ id: "1", name: "CheapFollows Instagram Likes", category: "Instagram" }),
      service({ id: "2", name: "SMM Panel TikTok Views", category: "TikTok" }),
      service({ id: "3", name: "YouTube Subscribers (Reseller)", category: "YouTube" }),
      service({ id: "4", name: "WhatsApp API likes", category: "Supplier deals" }),
    ];
    const items = boostItems(snapshot(tainted));
    // A tainted name falls back to a synthetic one instead of dropping a listing.
    // WhatsApp is listed too: the shop now sells every social platform the
    // supplier offers, not just the sixteen it has artwork for. Its supplier-ish
    // name is still replaced, which is the point of this test.
    expect(items).toHaveLength(4);
    const serialized = JSON.stringify(items).toLowerCase();
    for (const banned of ["cheapfollows", "smm", "panel", "reseller", "supplier", "wholesale", "api"]) {
      expect(serialized, banned).not.toContain(banned);
    }
    expect(items.map((item) => item.name)).toEqual([
      "Instagram likes", "TikTok views", "YouTube subscribers", "WhatsApp likes",
    ]);
  });

  it("lists recognized social intents and drops unsupported services", async () => {
    const { boostItems } = await import("@/lib/services/boosts/smm-catalog");
    const items = boostItems(snapshot([
      service({ id: "1", name: "Instagram Followers", category: "Instagram" }),
      service({ id: "2", name: "Instagram Likes", category: "Instagram" }),
      service({ id: "3", name: "TikTok Views", category: "TikTok" }),
      service({ id: "4", name: "YouTube Subscribers", category: "YouTube" }),
      service({ id: "5", name: "Custom Comments", category: "Instagram - Comments" }),
      service({ id: "6", name: "Website Traffic", category: "SEO" }),
    ]));
    // Ordered by platform, then intent, which is the order the shop groups in.
    expect(items.map((item) => item.tag)).toEqual(["Comments", "Followers", "Likes", "Views", "Subscribers"]);
    expect(items.some((item) => item.name.includes("Website Traffic"))).toBe(false);
  });

  it("matches a platform for artwork without matching a single letter loosely", async () => {
    const { boostItems } = await import("@/lib/services/boosts/smm-catalog");
    const items = boostItems(snapshot([
      service({ id: "1", name: "X Followers", category: "Social" }),
      // "Max" contains an x but is not the X platform.
      service({ id: "2", name: "Max Quality Followers", category: "Instagram" }),
      // No known platform: falls back to a generic mark rather than a wrong brand.
      service({ id: "3", name: "Myspace Plays", category: "Myspace" }),
    ]));
    expect(items.map((item) => item.platform)).toEqual(["Instagram", "X", "Myspace"]);
    expect(items[0]).toMatchObject({ platform: "Instagram", artwork: { kind: "brand", name: "instagram" } });
    // "Max" must not be read as the X platform.
    expect(items[1]).toMatchObject({ platform: "X", artwork: { kind: "brand", name: "x" } });
    // A platform we ship no mark for is still sold, named, and grouped under its
    // own name — with the promotion glyph rather than another platform's logo.
    expect(items[2]).toMatchObject({
      platform: "Myspace", name: "Myspace Plays", artwork: { kind: "service", name: "social-promotion" },
    });
  });

  it("does not list a service it cannot describe or place on a platform", async () => {
    const { boostItems } = await import("@/lib/services/boosts/smm-catalog");
    // A name and category are how the shop knows what it is selling. Rather than
    // invent "Social other", the service is left out — the panel still sells it,
    // we simply cannot promise a customer what it does.
    expect(boostItems(snapshot([service({ name: null, category: null })]))).toHaveLength(0);
  });
});

describe("selecting from a real panel catalogue", () => {
  it("lists every variant instead of collapsing to one per platform and intent", async () => {
    const { selectBoostServices } = await import("@/lib/services/boosts/smm-catalog");
    // The shape a production panel actually returns: many variants of the same
    // product, priced by speed and quality.
    const catalogue = [
      service({ id: "a", name: "Instagram Followers | 30 days refill", category: "Instagram", ratePer1000: 2_400, refill: true }),
      service({ id: "b", name: "Instagram Followers | no refill", category: "Instagram", ratePer1000: 1_800, refill: false }),
      service({ id: "c", name: "Instagram Followers | 90 days refill", category: "Instagram", ratePer1000: 3_100, refill: true }),
      service({ id: "d", name: "Instagram Likes", category: "Instagram", ratePer1000: 400, refill: false }),
      service({ id: "e", name: "TikTok Views", category: "TikTok", ratePer1000: 90 }),
    ];
    const selection = selectBoostServices(catalogue, "NGN");
    expect(selection.considered).toBe(5);
    // All three follower offers survive. Choosing between refill and price is
    // the customer's call, not a rule that silently discards two of them.
    expect(selection.listed).toBe(5);
    // Platform, then intent, then cheapest first.
    expect(selection.services.map((entry) => entry.id)).toEqual(["b", "a", "c", "d", "e"]);
  });

  it("drops inventory that is not a social boost at all", async () => {
    const { selectBoostServices } = await import("@/lib/services/boosts/smm-catalog");
    const selection = selectBoostServices([
      service({ id: "seo", name: "Website Traffic", category: "SEO" }),
      service({ id: "maps", name: "Google Maps Reviews", category: "Google" }),
      service({ id: "rev", name: "Trustpilot Reviews", category: "Reviews" }),
      service({ id: "ig", name: "Instagram Followers", category: "Instagram" }),
    ], "NGN");
    expect(selection.considered).toBe(4);
    expect(selection.services.map((entry) => entry.id)).toEqual(["ig"]);
  });

  it("lists expanded platforms such as Spotify plays", async () => {
    const { selectBoostServices } = await import("@/lib/services/boosts/smm-catalog");
    const selection = selectBoostServices([
      service({ id: "spot", name: "Spotify Plays", category: "Spotify" }),
    ], "NGN");
    expect(selection.listed).toBe(1);
    expect(selection.services[0].id).toBe("spot");
  });

  it("lists a large catalogue in full rather than a handful", async () => {
    const { selectBoostServices } = await import("@/lib/services/boosts/smm-catalog");
    const { PROMOTION_EXAMPLES } = await import("@/lib/services/service-explorer");
    // The shape a production panel actually returns: several variants per
    // platform and intent. This is the case that used to surface 17 cards.
    const catalogue = PROMOTION_EXAMPLES.map((entry) => entry.name).flatMap((platform) =>
      ["Followers", "Likes", "Views", "Subscribers"].flatMap((tag) =>
        Array.from({ length: 5 }, (_, index) =>
          service({
            id: `${platform}-${tag}-${index}`,
            name: `${platform} ${tag}`,
            category: platform,
            ratePer1000: 1_000 + index,
          }),
        ),
      ),
    );
    expect(catalogue).toHaveLength(PROMOTION_EXAMPLES.length * 4 * 5);
    const selection = selectBoostServices(catalogue, "NGN");
    expect(selection.listed).toBe(catalogue.length);
    expect(selection.services).toHaveLength(catalogue.length);
    // Every offer keeps its own identity, so every one is separately buyable.
    expect(new Set(selection.services.map((entry) => entry.id)).size).toBe(catalogue.length);
  });

  it("drops a repeated service id but keeps distinct offers", async () => {
    const { selectBoostServices } = await import("@/lib/services/boosts/smm-catalog");
    // The same id twice is the same product; two ids at one price are variants.
    const selection = selectBoostServices([
      service({ id: "same", ratePer1000: 900 }),
      service({ id: "same", ratePer1000: 900 }),
      service({ id: "other", ratePer1000: 900 }),
    ], "NGN");
    expect(selection.considered).toBe(3);
    expect(selection.services.map((entry) => entry.id)).toEqual(["other", "same"]);
  });
});

describe("naming and placing a real panel's offers", () => {
  it("takes the intent from the product name, not the shelf it sits on", async () => {
    const { boostItems } = await import("@/lib/services/boosts/smm-catalog");
    // Reading name and category as one string tagged this Likes, which merged a
    // followers offer into a different product and hid it from the shelf.
    const [item] = boostItems(snapshot([
      service({ name: "Instagram Followers", category: "Instagram Followers & Likes" }),
    ]));
    expect(item.tag).toBe("Followers");
  });

  it("does not mistake a turnaround promise for watch time", async () => {
    const { boostItems } = await import("@/lib/services/boosts/smm-catalog");
    const [followers] = boostItems(snapshot([
      service({ name: "Instagram Followers | 24 hours", category: "Instagram" }),
    ]));
    // "hours" used to outrank "followers", so this was sold as watch time.
    expect(followers.tag).toBe("Followers");

    const [watch] = boostItems(snapshot([
      service({ id: "w", name: "YouTube Watch Time 4000 hours", category: "YouTube" }),
    ]));
    expect(watch.tag).toBe("Watch time");
  });

  it("places a sub-platform before its parent", async () => {
    const { boostItems } = await import("@/lib/services/boosts/smm-catalog");
    const [item] = boostItems(snapshot([
      service({ name: "YouTube Music Plays", category: "YouTube Music" }),
    ]));
    // Matching "YouTube" first filed a music offer under the video platform.
    expect(item.platform).toBe("YouTube Music");
    expect(item.artwork).toEqual({ kind: "service", name: "social-promotion" });
  });

  it("names an unknown platform from its own words when the shelf is generic", async () => {
    const { boostItems } = await import("@/lib/services/boosts/smm-catalog");
    const [item] = boostItems(snapshot([
      service({ name: "Myspace Plays", category: "Default" }),
    ]));
    expect(item.platform).toBe("Myspace");
    expect(item.artwork).toEqual({ kind: "service", name: "social-promotion" });
  });

  it("refuses traffic, SEO and reviews even when a social platform is named", async () => {
    const { boostItems } = await import("@/lib/services/boosts/smm-catalog");
    // Widening to every social platform must not put categories on sale that
    // Pryva does not offer, however the supplier words them.
    const items = boostItems(snapshot([
      service({ id: "1", name: "Instagram Website Traffic Views", category: "SEO" }),
      service({ id: "2", name: "Google Maps Reviews", category: "Google" }),
      service({ id: "3", name: "Trustpilot Reviews", category: "Reviews" }),
      service({ id: "4", name: "Instagram SEO Followers", category: "Instagram" }),
    ]));
    expect(items).toHaveLength(0);
  });

  it("puts the differences between variants on the card", async () => {
    const { boostItems } = await import("@/lib/services/boosts/smm-catalog");
    const items = boostItems(snapshot([
      service({ id: "1", name: "Instagram Followers", refill: true, min: 100, max: 50_000 }),
      service({ id: "2", name: "Instagram Followers", refill: false, min: 500, max: 10_000, ratePer1000: 900 }),
    ]));
    // Two cards can share a name now, so refill, bounds and rate have to be
    // visible rather than only behind the Buy button.
    expect(items).toHaveLength(2);
    expect(items[0].detail).toContain("No refill");
    expect(items[0].detail).toContain("500–10,000 units");
    expect(items[1].detail).toContain("Refill included");
    expect(items[1].detail).toContain("100–50,000 units");
    expect(items[1].detail).toContain("per 1,000");
    expect(items[0].id).not.toBe(items[1].id);
  });

  it("resolves a variant that is not the cheapest, so every card is buyable", async () => {
    // The shop used to list only the cheapest offer, and the purchase page
    // resolved ids against that same collapsed set. Now that every variant is
    // listed, each one must still resolve — or its Buy link would 404.
    panel.services.mockResolvedValue([
      service({ id: "cheap", name: "Instagram Followers", ratePer1000: 900, refill: false }),
      service({ id: "premium", name: "Instagram Followers | 90 day refill", ratePer1000: 3_100, refill: true }),
    ]);
    panel.balance.mockResolvedValue({ balance: 10, currency: "NGN" });
    const { boostItems, readBoostSnapshot, findBoostListing } = await import("@/lib/services/boosts/smm-catalog");
    const items = boostItems(await readBoostSnapshot());
    expect(items).toHaveLength(2);
    const dearest = items[items.length - 1];
    const found = await findBoostListing(dearest.id);
    expect(found).not.toBeNull();
    expect(found?.listing.serviceId).toBe("premium");
  });
});

describe("boosting snapshot", () => {
  it("fails closed when the panel is not configured", async () => {
    panel.configured.mockReturnValue(false);
    const { readBoostSnapshot } = await import("@/lib/services/boosts/smm-catalog");
    await expect(readBoostSnapshot()).rejects.toThrow("Boosting supplier not configured");
    expect(panel.services).not.toHaveBeenCalled();
  });

  it("fails when the catalog cannot be read, but degrades when only the balance fails", async () => {
    panel.services.mockRejectedValue(new Error("upstream down"));
    const { readBoostSnapshot } = await import("@/lib/services/boosts/smm-catalog");
    await expect(readBoostSnapshot()).rejects.toThrow("Boosting catalog unavailable");

    vi.resetModules();
    panel.configured.mockReturnValue(true);
    panel.urlSetting.mockReturnValue("https://cheapfollows.test/api/v2");
    panel.services.mockResolvedValue([service()]);
    panel.balance.mockRejectedValue(new Error("balance unavailable"));
    const reloaded = await import("@/lib/services/boosts/smm-catalog");
    // Currency is unknown rather than assumed, so pricing cannot be derived —
    // but no listing is missing, so the catalogue is not "partial": a balance
    // read is a pricing input, and reporting it as a gap told customers to
    // retry a request that had already succeeded.
    expect(await reloaded.readBoostSnapshot()).toMatchObject({
      partial: false, balanceUnavailable: true, degraded: null, currency: null, balance: null,
    });
  });

  it("caps the catalog, caches briefly and deduplicates concurrent reads", async () => {
    panel.services.mockResolvedValue(Array.from({ length: 2500 }, (_, index) => service({ id: `svc-${index}` })));
    panel.balance.mockResolvedValue({ balance: 10, currency: "NGN" });
    const { readBoostSnapshot } = await import("@/lib/services/boosts/smm-catalog");

    const [first, second] = await Promise.all([readBoostSnapshot(), readBoostSnapshot()]);
    expect(first).toBe(second);
    expect(panel.services).toHaveBeenCalledTimes(1);
    expect(first.services).toHaveLength(2000);

    await readBoostSnapshot();
    expect(panel.services).toHaveBeenCalledTimes(1);
    await readBoostSnapshot(true);
    expect(panel.services).toHaveBeenCalledTimes(2);
  });
});

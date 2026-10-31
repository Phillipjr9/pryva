import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SmmService } from "@/lib/smm-panel";
import type { BoostSnapshot } from "@/lib/smm-catalog";

const panel = vi.hoisted(() => ({
  configured: vi.fn(), services: vi.fn(), balance: vi.fn(), urlSetting: vi.fn(),
}));
vi.mock("@/lib/smm-panel", () => ({
  isSmmPanelConfigured: panel.configured,
  listSmmServices: panel.services,
  getSmmBalance: panel.balance,
  smmPanelApiUrlSetting: panel.urlSetting,
}));

function service(overrides: Partial<SmmService> = {}): SmmService {
  return {
    id: "svc-101", name: "Instagram Followers", category: "Instagram - Followers", type: "Default",
    ratePer1000: 0.74, currency: "USD", min: 10, max: 10_000_000,
    refill: true, cancel: true, dripfeed: false,
    ...overrides,
  };
}

function snapshot(services: SmmService[]): BoostSnapshot {
  return { services, currency: "USD", balance: 177.69, partial: false, fetchedAt: "2026-01-01T00:00:00Z" };
}

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  panel.configured.mockReturnValue(true);
  // A panel brand that must never reach a customer.
  panel.urlSetting.mockReturnValue("https://cheapfollows.test/api/v2");
});

describe("boosting catalog listings", () => {
  it("prices a listing only when the supplier's currency can be converted honestly", async () => {
    const { boostItems } = await import("@/lib/smm-catalog");

    // A USD panel with no configured naira rate has no defensible retail price,
    // so it stays read-only rather than inventing an exchange rate.
    delete process.env.SMM_USD_NGN_RATE;
    const usd = boostItems(snapshot([service()]))[0];
    expect(usd).toMatchObject({ price: null, action: null, stock: null, myUnits: null });

    // Give it a rate and the same listing becomes buyable: 0.74 USD per 1,000 at
    // ₦1,600 and a 35% margin is ₦1,598.40 per 1,000, and the smallest order the
    // panel accepts is 10 units.
    process.env.SMM_USD_NGN_RATE = "1600";
    try {
      const priced = boostItems(snapshot([service()]))[0];
      expect(priced.price).toBe(16); // ceil(1598.4 * 10 / 1000)
      expect(priced.priceFrom).toBe(true);
      expect(priced.action).toEqual({ label: "Buy boost", href: `/dashboard/services/boost/${priced.id}` });
      expect(priced.stock).toBeNull();
    } finally {
      delete process.env.SMM_USD_NGN_RATE;
    }
  });

  it("readies an NGN-billed service without any exchange rate", async () => {
    const { boostItems } = await import("@/lib/smm-catalog");
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
    const { boostItems } = await import("@/lib/smm-catalog");
    const serialized = JSON.stringify(boostItems(snapshot([service({ id: "svc-secret-999", ratePer1000: 0.74 })])));
    expect(serialized).not.toContain("svc-secret-999");
    expect(serialized).not.toContain("0.74");
    expect(serialized).not.toContain("177.69");
    expect(boostItems(snapshot([service()]))[0].id).toMatch(/^live-boost-[0-9a-f]{20}$/);
  });

  it("collapses the emoji and newlines panels decorate names with", async () => {
    const { boostItems } = await import("@/lib/smm-catalog");
    const decorated = service({ name: "\u26a1 TikTok Views\n\n\ud83d\udfe2 Fast start \u267b\ufe0f Refill 30 days" });
    const [item] = boostItems(snapshot([decorated]));
    expect(item.name).toBe("TikTok Views Fast start Refill 30 days");
    expect(item.tag).toBe("Views");
    expect(item.name).not.toMatch(/[\u0000-\u001f\u007f]/);
  });

  it("never reveals the panel's name or that stock is bought in", async () => {
    const { boostItems } = await import("@/lib/smm-catalog");
    const tainted = [
      service({ id: "1", name: "CheapFollows Instagram Likes", category: "Instagram" }),
      service({ id: "2", name: "SMM Panel TikTok Views", category: "TikTok" }),
      service({ id: "3", name: "YouTube Subscribers (Reseller)", category: "YouTube" }),
      service({ id: "4", name: "WhatsApp API likes", category: "Supplier deals" }),
    ];
    const items = boostItems(snapshot(tainted));
    // Coverage must not depend on how a panel words its catalog, so a tainted
    // name falls back to a synthetic one instead of dropping the listing.
    expect(items).toHaveLength(4);
    const serialized = JSON.stringify(items).toLowerCase();
    for (const banned of ["cheapfollows", "smm", "panel", "reseller", "supplier", "wholesale", "api"]) {
      expect(serialized, banned).not.toContain(banned);
    }
    expect(items.map((item) => item.name)).toEqual([
      "Instagram likes", "TikTok views", "YouTube subscribers", "Social likes",
    ]);
  });

  it("derives the four filterable tags and keeps everything else under its own", async () => {
    const { boostItems } = await import("@/lib/smm-catalog");
    const items = boostItems(snapshot([
      service({ id: "1", name: "Instagram Followers", category: "Instagram" }),
      service({ id: "2", name: "Instagram Likes", category: "Instagram" }),
      service({ id: "3", name: "TikTok Views", category: "TikTok" }),
      service({ id: "4", name: "YouTube Subscribers", category: "YouTube" }),
      service({ id: "5", name: "Custom Comments", category: "Instagram - Comments" }),
    ]));
    expect(items.map((item) => item.tag)).toEqual([
      "Followers", "Likes", "Views", "Subscribers", "Instagram - Comments",
    ]);
  });

  it("matches a platform for artwork without matching a single letter loosely", async () => {
    const { boostItems } = await import("@/lib/smm-catalog");
    const items = boostItems(snapshot([
      service({ id: "1", name: "X Followers", category: "Social" }),
      // "Max" contains an x but is not the X platform.
      service({ id: "2", name: "Max Quality Followers", category: "Instagram" }),
      // No known platform: falls back to a generic mark rather than a wrong brand.
      service({ id: "3", name: "Soundcloud Plays", category: "Soundcloud" }),
    ]));
    expect(items[0]).toMatchObject({ platform: "X", artwork: { kind: "brand", name: "x" } });
    expect(items[1]).toMatchObject({ platform: "Instagram", artwork: { kind: "brand", name: "instagram" } });
    expect(items[2]).toMatchObject({ platform: undefined, tag: "Views", artwork: { kind: "service", name: "bulk" } });
  });

  it("synthesizes a listing when the panel reports neither a usable name nor category", async () => {
    const { boostItems } = await import("@/lib/smm-catalog");
    // No name and no category still yields a listing, because the panel did
    // report a service that can be ordered. Dropping it would silently reduce
    // coverage based on how one panel words its catalog.
    const [item] = boostItems(snapshot([service({ name: null, category: null })]));
    expect(item.name).toBe("Social other");
    expect(item.tag).toBe("Other");
  });
});

describe("boosting snapshot", () => {
  it("fails closed when the panel is not configured", async () => {
    panel.configured.mockReturnValue(false);
    const { readBoostSnapshot } = await import("@/lib/smm-catalog");
    await expect(readBoostSnapshot()).rejects.toThrow("Boosting supplier not configured");
    expect(panel.services).not.toHaveBeenCalled();
  });

  it("fails when the catalog cannot be read, but degrades when only the balance fails", async () => {
    panel.services.mockRejectedValue(new Error("upstream down"));
    const { readBoostSnapshot } = await import("@/lib/smm-catalog");
    await expect(readBoostSnapshot()).rejects.toThrow("Boosting catalog unavailable");

    vi.resetModules();
    panel.configured.mockReturnValue(true);
    panel.urlSetting.mockReturnValue("https://cheapfollows.test/api/v2");
    panel.services.mockResolvedValue([service()]);
    panel.balance.mockRejectedValue(new Error("balance unavailable"));
    const reloaded = await import("@/lib/smm-catalog");
    // Currency is unknown rather than assumed, so pricing cannot be derived.
    expect(await reloaded.readBoostSnapshot()).toMatchObject({ partial: true, currency: null, balance: null });
  });

  it("caps the catalog, caches briefly and deduplicates concurrent reads", async () => {
    panel.services.mockResolvedValue(Array.from({ length: 2500 }, (_, index) => service({ id: `svc-${index}` })));
    panel.balance.mockResolvedValue({ balance: 10, currency: "NGN" });
    const { readBoostSnapshot } = await import("@/lib/smm-catalog");

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

import { describe, expect, it } from "vitest";
import { explorerShortcuts, shortcutForExplorerItem } from "@/lib/services/quick-shortcuts";
import type { ExplorerItem } from "@/lib/services/service-explorer";

function item(overrides: Partial<ExplorerItem>): ExplorerItem {
  return {
    id: "one", category: "verification", name: "WhatsApp", description: "App offer", tag: "Other",
    artwork: { kind: "service", name: "numbers" }, source: "live", coverage: "catalog-country",
    stock: null, myUnits: null, price: null, action: null, ...overrides,
  };
}

describe("shortcut identities", () => {
  it("deduplicates reported apps and treats X and Twitter as the same platform, not a substring", () => {
    const x = item({ name: "X" });
    const twitter = item({ name: "Twitter", id: "two" });
    const xbox = item({ name: "Xbox", id: "three" });
    expect(explorerShortcuts([x, twitter, xbox, item({ name: "WhatsApp" }), item({ name: "whatsapp" })])).toEqual([
      { key: "x", label: "X / Twitter" }, { key: "whatsapp", label: "WhatsApp" }, { key: "xbox", label: "Xbox" },
    ]);
    expect(shortcutForExplorerItem(x)?.key).toBe(shortcutForExplorerItem(twitter)?.key);
    expect(shortcutForExplorerItem(xbox)?.key).not.toBe("x");
  });

  it("does not turn generic or unreported app metadata into a shortcut", () => {
    expect(shortcutForExplorerItem(item({ name: "Verification number" }))).toBeNull();
    expect(shortcutForExplorerItem(item({ coverage: "unconfirmed" }))).toBeNull();
    expect(shortcutForExplorerItem(item({ source: "catalog" }))).toBeNull();
    expect(shortcutForExplorerItem(item({ category: "social", platform: "Other platforms" }))).toBeNull();
    expect(shortcutForExplorerItem(item({ category: "social", platform: undefined }))).toBeNull();
    expect(shortcutForExplorerItem(item({ category: "email", source: "tool" }))).toBeNull();
  });

  it("uses reviewed digital platform metadata or explicit names, never a cosmetic logo", () => {
    const digital = item({ category: "topups", name: "20 Cash", source: "catalog", coverage: "unconfirmed", platform: "8 Ball Pool" });
    expect(shortcutForExplorerItem(digital)).toEqual({ key: "8 ball pool", label: "8 Ball Pool" });
    expect(shortcutForExplorerItem({ ...digital, platform: undefined, artwork: { kind: "digital-product", art: { kind: "category", key: "8-ball-pool" } } }))
      .toEqual({ key: "20 cash", label: "20 Cash" });
    expect(shortcutForExplorerItem({ ...digital, platform: undefined, name: "Netflix Premium 1 month" }))
      .toEqual({ key: "netflix", label: "Netflix" });
    expect(shortcutForExplorerItem({ ...digital, platform: undefined, name: "Steam Wallet Partner Gift Card 50 USD" }))
      .toEqual({ key: "steam wallet partner", label: "Steam Wallet Partner" });
    expect(shortcutForExplorerItem({ ...digital, platform: undefined, name: "Unfamiliar Game 20 Coins" }))
      .toEqual({ key: "unfamiliar game 20 coins", label: "Unfamiliar Game 20 Coins" });
  });
});

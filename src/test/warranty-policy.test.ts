import { describe, expect, it } from "vitest";
import {
  DEFAULT_WARRANTY_DAYS,
  WARRANTY_GROUPS,
  fulfilmentLabel,
  warrantyBadge,
  warrantyDaysForGroup,
  warrantyLabel,
} from "@/lib/warranty";
import { GROUP_LABEL_VALUES } from "@/lib/marketplace-suppliers";

/**
 * The replacement promise a customer actually reads.
 *
 * This is Pryva's own policy — a claim lands here, never with whoever supplied
 * the account — so two things matter: the wording is honest and free of sourcing
 * language, and the number of days cannot silently drift when the catalog grows.
 */
describe("warranty policy", () => {
  it("gives every catalog group an explicit warranty instead of inheriting the default", () => {
    // The real guard: a group label with no row in the warranty table falls back
    // to 30 days silently. That is how a streaming product would end up
    // promising one month instead of four, with nothing failing anywhere.
    const missing = GROUP_LABEL_VALUES.filter((label) => !WARRANTY_GROUPS.includes(label));
    expect(missing, "groups with no explicit warranty row").toEqual([]);

    const unused = WARRANTY_GROUPS.filter((label) => !GROUP_LABEL_VALUES.includes(label));
    expect(unused, "warranty rows no group can ever reach").toEqual([]);
  });

  it("promises four months on streaming, as decided", () => {
    expect(warrantyDaysForGroup("Streaming")).toBe(120);
    expect(warrantyLabel(120)).toBe("4-month replacement warranty");
    expect(warrantyBadge(120)).toBe("4-month warranty");
  });

  it("keeps the other groups on their intended windows", () => {
    expect(warrantyDaysForGroup("Video")).toBe(60);
    for (const group of ["Email", "Social", "Apple ID", "Developer", "AI tools", "Gaming", "Other"]) {
      expect(warrantyDaysForGroup(group), group).toBe(30);
    }
    expect(warrantyDaysForGroup("Video")).not.toBe(DEFAULT_WARRANTY_DAYS);
  });

  it("falls back to the default for anything it does not recognise", () => {
    expect(warrantyDaysForGroup(null)).toBe(DEFAULT_WARRANTY_DAYS);
    expect(warrantyDaysForGroup(undefined)).toBe(DEFAULT_WARRANTY_DAYS);
    expect(warrantyDaysForGroup("")).toBe(DEFAULT_WARRANTY_DAYS);
    expect(warrantyDaysForGroup("Not a real group")).toBe(DEFAULT_WARRANTY_DAYS);
    expect(warrantyDaysForGroup(42 as unknown as string)).toBe(DEFAULT_WARRANTY_DAYS);
  });

  it("reads whole months as months and everything else as days", () => {
    expect(warrantyLabel(30)).toBe("30-day replacement warranty");
    expect(warrantyLabel(45)).toBe("45-day replacement warranty");
    expect(warrantyLabel(60)).toBe("2-month replacement warranty");
    expect(warrantyLabel(90)).toBe("3-month replacement warranty");
    expect(warrantyLabel(365)).toBe("365-day replacement warranty");

    expect(warrantyBadge(30)).toBe("30-day warranty");
    expect(warrantyBadge(90)).toBe("3-month warranty");
  });

  it("promises nothing when there is nothing honest to promise", () => {
    // A listing with no warranty must not inherit a reassuring label: null means
    // the storefront shows no badge at all rather than a promise we would break.
    for (const value of [0, -1, -30, 1.5, NaN, Infinity, null, undefined, "30" as unknown as number]) {
      expect(warrantyLabel(value), String(value)).toBeNull();
      expect(warrantyBadge(value), String(value)).toBeNull();
    }
  });

  it("describes fulfilment without implying the item ships from a warehouse", () => {
    expect(fulfilmentLabel("instant")).toBe("Instant delivery");
    // Hand-prepared items are confirmed by a person, and the copy says so
    // without explaining where the item comes from.
    expect(fulfilmentLabel("manual")).toBe("Delivered after confirmation");
  });

  it("keeps sourcing language out of every string a customer reads", () => {
    const rendered = [
      ...GROUP_LABEL_VALUES.map((group) => warrantyLabel(warrantyDaysForGroup(group))),
      ...GROUP_LABEL_VALUES.map((group) => warrantyBadge(warrantyDaysForGroup(group))),
      fulfilmentLabel("instant"),
      fulfilmentLabel("manual"),
    ].filter((value): value is string => typeof value === "string");

    expect(rendered.length).toBeGreaterThan(10);
    for (const text of rendered) {
      const lower = text.toLowerCase();
      for (const word of [
        "supplier", "reseller", "wholesale", "vendor", "upstream", "source",
        "bulkacc", "accszone", "fleexa", "freshbulkacc", "third party", "partner",
      ]) {
        expect(lower, `"${text}" mentions ${word}`).not.toContain(word);
      }
    }
  });

  it("never claims Pryva operates or is partnered with the platforms", () => {
    for (const text of [warrantyLabel(120), warrantyBadge(120), fulfilmentLabel("manual")]) {
      const lower = (text ?? "").toLowerCase();
      for (const claim of ["official", "authorized", "partner", "verified by", "operated by", "owned by"]) {
        expect(lower, `"${text}" claims ${claim}`).not.toContain(claim);
      }
    }
  });
});

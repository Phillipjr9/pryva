import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }));
vi.mock("next/navigation", () => ({ redirect }));
import DigitalCatalogPage from "@/app/dashboard/digital-catalog/page";
import GiftCardsPage from "@/app/dashboard/gift-cards/page";

describe("legacy catalogue entry points", () => {
  it("opens the shared service hub from old digital catalogue links", () => {
    expect(() => DigitalCatalogPage()).toThrow("redirect:/dashboard/services");
  });
  it("preserves wallet-card links by opening gift-card management inside the category", () => {
    expect(() => GiftCardsPage()).toThrow("redirect:/dashboard/services?category=gift-cards#wallet-gifts");
  });
});

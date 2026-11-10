// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ServiceCard } from "@/components/dashboard/ServiceExplorer";
import type { ExplorerItem } from "@/lib/services/service-explorer";

afterEach(cleanup);

const item: ExplorerItem = {
  id: "test", category: "verification", name: "Activision", description: "Live offer", tag: "Other",
  artwork: { kind: "simple-icon", slug: "activision", hex: "000000", version: "16.36.0" },
  source: "live", coverage: "catalog-country", stock: 3, myUnits: null, price: 1000, action: null,
};

describe("verification artwork failures", () => {
  it("keeps the listing usable if the real icon fails to load", () => {
    const { container } = render(<ServiceCard item={item} countryName="United States" />);
    const img = container.querySelector("img")!;
    expect(img).not.toBeNull();
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { name: "Activision" })).toBeTruthy();
  });

  it("renders a social listing's locally bundled platform mark", () => {
    const socialItem: ExplorerItem = { ...item, category: "social", name: "Shopee Followers", artwork: { kind: "verified-brand-logo", slug: "social-shopee" } };
    const { container } = render(<ServiceCard item={socialItem} countryName="Nigeria" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/verification-logos/social-shopee.svg");
    expect(screen.getByRole("heading", { name: "Shopee Followers" })).toBeTruthy();
  });

  it("renders a reviewed raster platform mark from the local bundle", () => {
    const raster: ExplorerItem = { ...item, category: "social", name: "Likee Comments", artwork: { kind: "verified-brand-logo", slug: "social-likee", format: "png" } };
    const { container } = render(<ServiceCard item={raster} countryName="Nigeria" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/verification-logos/social-likee.png");
    expect(screen.getByRole("heading", { name: "Likee Comments" })).toBeTruthy();
  });

  it("falls back on a broken bundled logo and resets for a different logo", () => {
    const { container, rerender } = render(<ServiceCard item={{ ...item, artwork: { kind: "verified-brand-logo", slug: "adobe" } }} countryName="United States" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/verification-logos/adobe.svg");
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { name: "Activision" })).toBeTruthy();
    rerender(<ServiceCard item={{ ...item, artwork: { kind: "verified-brand-logo", slug: "authy" } }} countryName="United States" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/verification-logos/authy.svg");
  });

  it("resets a failed website icon when a card receives a different website", () => {
    const { container, rerender } = render(<ServiceCard item={{ ...item, artwork: { kind: "site-favicon", domain: "25clicks.com" } }} countryName="United States" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    rerender(<ServiceCard item={{ ...item, artwork: { kind: "site-favicon", domain: "99ranch.com" } }} countryName="United States" />);
    expect(container.querySelector("img")?.getAttribute("src")).toContain("99ranch.com");
  });
});

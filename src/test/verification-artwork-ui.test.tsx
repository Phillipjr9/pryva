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

/**
 * The dashboard listing is text-only, so artwork metadata no longer decides what
 * a customer sees. What still matters is that a listing never becomes unusable
 * because of it: every state renders the same name, price and action, with no
 * image request at all — in particular no third-party favicon fetch.
 */
describe("verification listings without artwork", () => {
  it("renders an offer as text and requests no external image", () => {
    const { container } = render(<ServiceCard item={item} countryName="United States" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("google.com/s2/favicons");
    expect(container.innerHTML).not.toContain("cdn.jsdelivr.net");
    expect(screen.getByRole("heading", { name: "Activision" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Purchasing locked" })).toBeTruthy();
  });

  it("does not change with a bundled platform mark", () => {
    const socialItem: ExplorerItem = { ...item, category: "social", name: "Shopee Followers", artwork: { kind: "verified-brand-logo", slug: "social-shopee" } };
    const { container } = render(<ServiceCard item={socialItem} countryName="Nigeria" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("heading", { name: "Shopee Followers" })).toBeTruthy();
  });

  it("keeps a reviewable card when the artwork changes between renders", () => {
    const { container, rerender } = render(<ServiceCard item={{ ...item, artwork: { kind: "verified-brand-logo", slug: "adobe" } }} countryName="United States" />);
    rerender(<ServiceCard item={{ ...item, artwork: { kind: "site-favicon", domain: "25clicks.com" } }} countryName="United States" />);
    rerender(<ServiceCard item={{ ...item, artwork: { kind: "unidentified-inbox" } }} countryName="United States" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { name: "Activision" })).toBeTruthy();
  });
});

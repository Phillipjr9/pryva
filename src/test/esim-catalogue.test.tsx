// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { catalogueItems, ESIM_CATALOGUE_LIMIT, type EsimOffer } from "@/lib/esim-catalog";
import { EsimCatalogue } from "@/app/dashboard/esim/EsimCatalogue";

/**
 * The catalogue, as a catalogue.
 *
 * The explorer answers "what can I buy for Nigeria" and never "what is there", so
 * a supplier list of hundreds of plans looked like the handful that named one
 * country. This page exists to show the whole thing, which makes two things worth
 * pinning: that it cannot leak the provider reference or our cost, and that its
 * counts are the real ones rather than a page of twenty-four dressed up as a
 * catalogue.
 */

function offer(overrides: Partial<EsimOffer> = {}): EsimOffer {
  return {
    id: "live-esim-0123456789abcdef0123",
    planId: "pln_secret_reference",
    name: "Nigeria 1GB",
    region: "Africa",
    countries: ["Nigeria"],
    dataLabel: "1GB of data",
    validityLabel: "7 days",
    coverage: "catalog-country",
    costNgn: 4_500,
    priceNgn: 6_500,
    purchasable: true,
    ...overrides,
  };
}

afterEach(cleanup);

describe("catalogueItems", () => {
  it("never carries the provider reference or our cost into a page", () => {
    const [item] = catalogueItems([offer()]);
    const serialised = JSON.stringify(item);
    expect(serialised).not.toContain("pln_secret_reference");
    expect(serialised).not.toContain("4500");
    expect(item).not.toHaveProperty("planId");
    expect(item).not.toHaveProperty("costNgn");
  });

  it("keeps what a shopper needs: price, size, validity, coverage", () => {
    const [item] = catalogueItems([offer()]);
    expect(item).toMatchObject({
      name: "Nigeria 1GB",
      region: "Africa",
      dataLabel: "1GB of data",
      validityLabel: "7 days",
      priceNgn: 6_500,
      purchasable: true,
      destinations: 1,
      global: false,
    });
  });

  it("marks a plan with no named destination as global", () => {
    const [item] = catalogueItems([offer({ countries: [], coverage: "not-country-specific", region: "Worldwide" })]);
    expect(item.global).toBe(true);
    expect(item.destinations).toBe(0);
  });

  it("caps the list, and says so rather than pretending it is everything", () => {
    const many = Array.from({ length: ESIM_CATALOGUE_LIMIT + 5 }, (_, index) =>
      offer({ id: `live-esim-${String(index).padStart(20, "0")}`, name: `Plan ${index}` }),
    );
    expect(catalogueItems(many)).toHaveLength(ESIM_CATALOGUE_LIMIT);
    expect(catalogueItems(many, 3)).toHaveLength(3);
  });
});

describe("EsimCatalogue", () => {
  const items = catalogueItems([
    offer({ id: "live-esim-aaaaaaaaaaaaaaaaaaaa", name: "Nigeria 1GB", region: "Africa", priceNgn: 6_500 }),
    offer({ id: "live-esim-bbbbbbbbbbbbbbbbbbbb", name: "Ghana 2GB", region: "Africa", priceNgn: 9_000 }),
    offer({ id: "live-esim-cccccccccccccccccccc", name: "Germany 5GB", region: "Europe", priceNgn: 12_000 }),
    offer({
      id: "live-esim-dddddddddddddddddddd",
      name: "Global 10GB",
      region: "Worldwide",
      countries: [],
      coverage: "not-country-specific",
      priceNgn: 40_000,
      purchasable: false,
    }),
  ]);

  it("shows how many plans match, not how many fit on screen", () => {
    render(<EsimCatalogue items={items} truncated={false} />);
    expect(screen.getByText(/4 plans match/)).toBeTruthy();
    // Three of the four are sellable; the count above is the whole filtered set.
    expect(screen.getAllByRole("link", { name: "Buy eSIM" })).toHaveLength(3);
  });

  it("filters by search across name, region and allowance", () => {
    render(<EsimCatalogue items={items} truncated={false} />);
    fireEvent.change(screen.getByPlaceholderText("Search a country, region or data allowance"), {
      target: { value: "germany" },
    });
    expect(screen.getByText(/1 plan match/)).toBeTruthy();
    expect(screen.getByText("Germany 5GB")).toBeTruthy();
    expect(screen.queryByText("Nigeria 1GB")).toBeNull();
  });

  it("filters by region and counts each one", () => {
    render(<EsimCatalogue items={items} truncated={false} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["all", "Africa", "Europe", "Worldwide"]);
    fireEvent.change(select, { target: { value: "Africa" } });
    expect(screen.getByText(/2 plans match/)).toBeTruthy();
  });

  it("lists a plan the margin guard refuses without a buy button, and says why", () => {
    render(<EsimCatalogue items={items} truncated={false} />);
    expect(screen.getAllByText("Not sellable at this price")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Buy eSIM" })).toHaveLength(3);
    expect(screen.getByText("Global 10GB")).toBeTruthy();
  });

  it("pages rather than rendering the whole supplier feed at once", () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      offer({ id: `live-esim-${String(index).padStart(20, "0")}`, name: `Plan ${index}` }),
    );
    render(<EsimCatalogue items={catalogueItems(many)} truncated={false} />);
    expect(screen.queryByText("Plan 29")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show more/ }));
    expect(screen.getByText("Plan 29")).toBeTruthy();
  });

  it("keeps the empty state honest about what it means", () => {
    render(<EsimCatalogue items={items} truncated={false} />);
    fireEvent.change(screen.getByPlaceholderText("Search a country, region or data allowance"), {
      target: { value: "atlantis" },
    });
    expect(screen.getByText(/does not mean the destination is unsupported/)).toBeTruthy();
  });
});

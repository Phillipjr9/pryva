// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EXPLORER_CATEGORIES } from "@/lib/service-explorer";
import { readinessSummary, orderByReadiness, SERVICE_STATE_RANK } from "@/lib/service-states";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const config = vi.hoisted(() => ({ fleexa: false, boosting: false, accounts: false, preview: true }));

vi.mock("@/lib/fleexa", () => ({ isFleexaConfigured: () => config.fleexa }));
vi.mock("@/lib/smm-panel", () => ({ isSmmPanelConfigured: () => config.boosting }));
vi.mock("@/lib/marketplace-policy", () => ({ isMarketplaceCheckoutConfigured: () => config.accounts }));
vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: () => config.preview }));

const { readServiceReadiness } = await import("@/lib/service-readiness");

afterEach(() => {
  cleanup();
  config.fleexa = false;
  config.boosting = false;
  config.accounts = false;
  config.preview = true;
});

describe("service readiness", () => {
  it("gives every category exactly one verdict", () => {
    const readiness = readServiceReadiness();
    expect(readiness.map((entry) => entry.id).sort()).toEqual(
      EXPLORER_CATEGORIES.map((entry) => entry.id).sort(),
    );
    for (const entry of readiness) {
      expect(entry.detail.length, entry.id).toBeGreaterThan(20);
    }
  });

  it("puts what a customer can actually do first", () => {
    config.fleexa = true;
    config.boosting = true;
    config.accounts = true;
    const readiness = readServiceReadiness();
    const ranks = readiness.map((entry) => SERVICE_STATE_RANK[entry.state]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(readiness[0].state).toBe("buy");
    expect(readiness.at(-1)?.state).toBe("unavailable");
  });

  it("says ordering is paused when a supplier key is missing, not that the category is gone", () => {
    const readiness = readServiceReadiness();
    const numbers = readiness.find((entry) => entry.id === "numbers")!;
    expect(numbers.state).toBe("paused");
    expect(numbers.detail).toMatch(/supplier/i);

    config.fleexa = true;
    const live = readServiceReadiness().find((entry) => entry.id === "numbers")!;
    expect(live.state).toBe("buy");
  });

  it("keeps the free inbox free on a persistent database and unavailable in the preview", () => {
    expect(readServiceReadiness().find((entry) => entry.id === "email")!.state).toBe("paused");
    config.preview = false;
    expect(readServiceReadiness().find((entry) => entry.id === "email")!.state).toBe("free");
  });

  it("summarises only states that are present", () => {
    const summary = readinessSummary([
      { state: "buy" },
      { state: "buy" },
      { state: "unavailable" },
    ]);
    expect(summary).toContain("2 ready to buy");
    expect(summary).toContain("1 not connected");
    expect(summary).not.toContain("ordered");
    expect(readinessSummary([])).toBe("");
  });
});

describe("the hub's arrangement", () => {
  const readiness = [
    { id: "proxies" as const, label: "Proxies", state: "unavailable" as const, detail: "No proxy supplier is connected, so nothing can be ordered." },
    { id: "numbers" as const, label: "Number plans", state: "buy" as const, detail: "Single-use numbers and rentals are delivered automatically." },
    { id: "data" as const, label: "Mobile data", state: "paused" as const, detail: "Data plans are catalogued, but no supplier is connected." },
  ];

  it("orders the category chips by readiness and keeps the rest after them", () => {
    const { container } = render(
      <ServiceExplorer initialCountry="ng" initialCategory={null} readiness={readiness} />,
    );
    const chips = [...container.querySelectorAll('[aria-label="Service categories"] button')].map(
      (chip) => chip.textContent ?? "",
    );
    const index = (label: string) => chips.findIndex((text) => text.includes(label));
    expect(index("Number plans")).toBeLessThan(index("Mobile data"));
    expect(index("Mobile data")).toBeLessThan(index("Proxies"));
    // Categories with no verdict from the server still appear, after the known ones.
    expect(index("App verification")).toBeGreaterThan(index("Proxies"));
  });

  it("explains a category that cannot be ordered and offers a way to ask", () => {
    render(<ServiceExplorer initialCountry="ng" initialCategory="data" readiness={readiness} />);
    expect(screen.getByText(/no supplier is connected/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Ask about it" });
    expect(link.getAttribute("href")).toContain("/dashboard/support#ask=");
    expect(decodeURIComponent(link.getAttribute("href")!)).toContain("Mobile data");
  });

  it("does not offer the request path for a category that can be bought", () => {
    render(<ServiceExplorer initialCountry="ng" initialCategory="numbers" readiness={readiness} />);
    expect(screen.queryByRole("link", { name: "Ask about it" })).toBeNull();
  });

  it("keeps the catalogue order when no readiness was supplied", () => {
    const ordered = orderByReadiness([
      { id: "a", state: "unavailable" as const },
      { id: "b", state: "unavailable" as const },
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});

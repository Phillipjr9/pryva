// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EXPLORER_CATEGORIES } from "@/lib/services/service-explorer";
import { readinessSummary, orderByReadiness, SERVICE_STATE_RANK } from "@/lib/services/service-states";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const config = vi.hoisted(() => ({ fleexa: false, bitcall: false, boosting: false, accounts: false, preview: true }));

vi.mock("@/lib/providers/fleexa", () => ({ isFleexaConfigured: () => config.fleexa }));
vi.mock("@/lib/providers/bitcall", () => ({ isBitcallConfigured: () => config.bitcall }));
vi.mock("@/lib/providers/smm-panel", () => ({ isSmmPanelConfigured: () => config.boosting }));
vi.mock("@/lib/services/accounts/marketplace-policy", () => ({ isMarketplaceCheckoutConfigured: () => config.accounts }));
vi.mock("@/lib/platform/demo-policy", () => ({ isPreviewDatabase: () => config.preview }));

const { readServiceReadiness } = await import("@/lib/services/service-readiness");
const { serviceConfigured, laneConfigured } = await import("@/lib/services/service-config");

afterEach(() => {
  cleanup();
  config.fleexa = false;
  config.bitcall = false;
  config.boosting = false;
  config.accounts = false;
  config.preview = true;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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
    config.preview = false;
    config.fleexa = true;
    config.bitcall = true;
    config.boosting = true;
    config.accounts = true;
    const readiness = readServiceReadiness();
    const ranks = readiness.map((entry) => SERVICE_STATE_RANK[entry.state]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(readiness[0].state).toBe("buy");
    expect(readiness.at(-1)?.state).toBe("preview");
  });

  it("says ordering is paused when a supplier key is missing, not that the category is gone", () => {
    config.preview = false;
    const readiness = readServiceReadiness();
    const numbers = readiness.find((entry) => entry.id === "numbers")!;
    expect(numbers.state).toBe("paused");
    expect(numbers.detail).toMatch(/not connected/i);

    config.fleexa = true;
    const stillPaused = readServiceReadiness().find((entry) => entry.id === "numbers")!;
    expect(stillPaused.state).toBe("paused");

    config.bitcall = true;
    const live = readServiceReadiness().find((entry) => entry.id === "numbers")!;
    expect(live.state).toBe("buy");
  });

  it("marks proxies ready from the configured supplier while keeping unfinished data and subscriptions paused", () => {
    config.preview = false;
    config.fleexa = true;
    const states = new Map(readServiceReadiness().map((entry) => [entry.id, entry]));
    expect(states.get("proxies")?.state).toBe("buy");
    expect(states.get("proxies")?.detail).toMatch(/live proxy plans/i);
    expect(serviceConfigured("proxies")).toBe(true);
    expect(laneConfigured("proxies")).toBe(true);
    for (const id of ["data", "subscriptions"] as const) {
      expect(states.get(id)?.state).toBe("paused");
      expect(serviceConfigured(id)).toBe(false);
      expect(laneConfigured(id)).toBe(false);
    }
  });

  it("does not advertise purchases or inboxes from a Vercel preview with live configuration", () => {
    config.preview = false;
    config.fleexa = true;
    config.bitcall = true;
    config.boosting = true;
    config.accounts = true;
    vi.stubEnv("VERCEL_ENV", "preview");
    const states = new Map(readServiceReadiness().map((entry) => [entry.id, entry.state]));
    for (const id of ["social", "numbers", "esim", "accounts", "tools", "email"] as const) expect(states.get(id)).toBe("paused");
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
    render(<ServiceExplorer initialCountry="ng" initialCategory="proxies" readiness={readiness} />);
    expect(screen.getByText(/No proxy supplier is connected/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Ask about it" });
    expect(link.getAttribute("href")).toContain("/dashboard/support#ask=");
    expect(decodeURIComponent(link.getAttribute("href")!)).toContain("Proxies");
  });

  it("explains an empty data catalogue without inventing listings or enabling checkout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ plans: [], checkedAt: "2026-11-12T12:00:00Z", stale: false,
      checkoutReason: "Purchase and delivery tracking are being connected." })));
    render(<ServiceExplorer initialCountry="ng" initialCategory="data" />);
    expect(screen.getByText(/Purchases are not available from this catalogue yet/)).toBeTruthy();
    expect(await screen.findByText(/0 bundles · lowest price first/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "MTN 1GB" })).toBeNull();
    expect(screen.queryByRole("button", { name: /buy|purchase|checkout/i })).toBeNull();
  });

  it("explains an empty subscription shelf without claiming every subscription is disabled", () => {
    render(<ServiceExplorer initialCountry="ng" initialCategory="subscriptions" />);
    expect(screen.getByText(/No subscription listings have loaded/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ask about subscriptions" }).getAttribute("href")).toBe("/dashboard/support");
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

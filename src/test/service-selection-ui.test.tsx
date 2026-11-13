// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";
import { DigitalServicesForm } from "@/app/dashboard/digital/DigitalServicesForm";
import { getDigitalService } from "@/lib/services/digital/digital-services";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const user = { id: "buyer", name: "Ada", email: "ada@example.test", walletBalance: 50000, emailVerifiedAt: null, createdAt: new Date(0) };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("choosing services", () => {
  it("filters to the chosen category and type, links the exact item, and restores history", async () => {
    window.history.replaceState(null, "", "/dashboard/services");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      const parsed = new URL(url, window.location.origin);
      if (parsed.pathname === "/api/airtime/plans") return Response.json({
        plans: [], checkedAt: "2026-11-12T12:00:00Z", stale: false, checkoutReason: "Checkout is not connected.",
      });
      const feed = parsed.searchParams.get("feed");
      return Response.json({ ok: true, country: parsed.searchParams.get("country"), live: true, partial: false, items:
        feed === "social" ? [
          { id: "live-views", category: "social", name: "Instagram views", description: "Supplier listing", tag: "Views", artwork: { kind: "brand", name: "instagram" }, source: "live", coverage: "not-country-specific", stock: null, myUnits: null, price: 1200, action: { label: "Order", href: "/dashboard/services/boost/live-views" } },
        ] : feed === "verification" ? [
          { id: "live-whatsapp", category: "verification", name: "WhatsApp", description: "Supplier listing", tag: "Messaging", artwork: { kind: "brand", name: "whatsapp" }, source: "live", coverage: "catalog-country", stock: null, myUnits: null, price: null, action: null },
        ] : [],
      });
    }));
    render(<ServiceExplorer initialCountry={null} initialCategory={null} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nigeria" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Service category" }), { target: { value: "social" } });
    expect(screen.getByRole("heading", { level: 1, name: "Social promotion" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Service category" }) as HTMLSelectElement).value).toBe("social");
    expect(screen.queryByRole("heading", { name: "WhatsApp" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Views" }));
    const card = (await screen.findByRole("heading", { name: "Instagram views" })).closest("article")!;
    // The only social card is an actual supplier response, not a fabricated entry.
    expect(within(card).getByRole("link", { name: "Order" }).getAttribute("href")).toBe("/dashboard/services/boost/live-views");
    expect(screen.queryByRole("heading", { name: "Instagram followers" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Service category" }), { target: { value: "verification" } });
    expect(await screen.findByRole("heading", { name: "WhatsApp" })).toBeTruthy();
    expect(window.location.search).toBe("?country=ng&category=verification");
    window.history.back();
    await waitFor(() => expect(window.location.search).toBe("?country=ng&category=social"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Social promotion" })).toBeTruthy());
    expect((screen.getByRole("combobox", { name: "Service category" }) as HTMLSelectElement).value).toBe("social");
    expect(screen.queryByRole("heading", { name: "WhatsApp" })).toBeNull();
    window.history.forward();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "App verification" })).toBeTruthy());
    expect(await screen.findByRole("heading", { name: "WhatsApp" })).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Service category" }), { target: { value: "numbers" } });
    expect(screen.getByRole("heading", { level: 1, name: "Number plans" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rental" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Single use" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rental" }));
    expect(screen.getAllByRole("heading", { name: "Nigeria rental" })).toHaveLength(3);
    expect(screen.queryByRole("heading", { name: "Nigeria" })).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Service category" }), { target: { value: "data" } });
    expect(screen.getByRole("heading", { level: 1, name: "Mobile data & airtime" })).toBeTruthy();
    expect(screen.getByText(/Purchases are not available from this catalogue yet/)).toBeTruthy();
    expect(await screen.findByText(/0 bundles · lowest price first/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "MTN 1GB" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Airtel 1GB" })).toBeNull();
  });

  it("directs people looking for paid email accounts from Email OTP to the account marketplace", () => {
    window.history.replaceState(null, "", "/dashboard/services?country=us&category=email");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, country: "us", live: true, items: [] })));
    render(<ServiceExplorer initialCountry="us" initialCategory="email" />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search services" }), { target: { value: "Gmail" } });
    expect(screen.getByText(/Temporary inbox and email verification services are separate from paid accounts/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Browse email accounts" }).getAttribute("href")).toBe("/dashboard/accounts");
    fireEvent.change(screen.getByRole("combobox", { name: "Service category" }), { target: { value: "esim" } });
    expect(screen.queryByRole("link", { name: "Browse email accounts" })).toBeNull();
    expect(new URLSearchParams(window.location.search).get("country")).toBe("us");
  });

  it("initializes the dropdown from a category link and resets filters when selecting all", () => {
    window.history.replaceState(null, "", "/dashboard/services?country=us&category=esim");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, country: "us", live: true, items: [] })));
    render(<ServiceExplorer initialCountry="us" initialCategory="esim" />);
    const picker = screen.getByRole("combobox", { name: "Service category" }) as HTMLSelectElement;
    expect(picker.value).toBe("esim");
    const search = screen.getByRole("searchbox", { name: "Search services" }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "travel" } });
    fireEvent.change(picker, { target: { value: "all" } });
    expect(picker.value).toBe("all");
    expect(search.value).toBe("");
    expect(screen.getByRole("heading", { name: "Explore services" })).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get("country")).toBe("us");
    expect(new URLSearchParams(window.location.search).has("category")).toBe(false);
  });

  it("never retains another subscription or country as the active plan", () => {
    const { rerender } = render(<DigitalServicesForm user={user} service={getDigitalService("netflix")!} countryCode="ng" />);
    fireEvent.click(screen.getByRole("button", { name: /Netflix Premium - 1 Month/ }));
    expect(screen.getByText("Selected Plan")).toBeTruthy();
    rerender(<DigitalServicesForm user={user} service={getDigitalService("spotify")!} countryCode="ng" />);
    expect(screen.queryByText("Selected Plan")).toBeNull();
    expect(screen.getByRole("button", { name: "Digital subscriptions are not available yet" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Spotify Premium - 1 Month/ }));
    expect(screen.getByText("Selected Plan")).toBeTruthy();
    rerender(<DigitalServicesForm user={user} service={getDigitalService("spotify")!} countryCode="gb" />);
    expect(screen.queryByText("Selected Plan")).toBeNull();
    expect(screen.getByRole("button", { name: "Digital subscriptions are not available yet" }).hasAttribute("disabled")).toBe(true);
  });

  it("never submits a subscription purchase, because none can be delivered", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<DigitalServicesForm user={user} service={getDigitalService("spotify")!} countryCode="gb" />);
    fireEvent.click(screen.getByRole("button", { name: /Spotify Premium - 1 Month/ }));
    expect(screen.getByText("Selected Plan")).toBeTruthy();
    // The only button that could submit is permanently disabled, and selecting a
    // plan must not re-enable it or fire a request.
    expect(screen.getByRole("button", { name: "Digital subscriptions are not available yet" }).hasAttribute("disabled")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

});

describe("number-plan navigation", () => {
  it("opens app-specific listings without losing the selected country", async () => {
    window.history.replaceState(null, "", "/dashboard/services?country=us&category=numbers");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      ok: true, country: "us", live: true, partial: false, items: [{ id: "otp-1", category: "verification", name: "Test app", description: "Live listing", tag: "Other", artwork: { kind: "service", name: "numbers" }, source: "live", coverage: "catalog-country", stock: 7, myUnits: null, price: null, action: null }],
    }) }));
    render(<ServiceExplorer initialCountry="us" initialCategory="numbers" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Service category" }), { target: { value: "verification" } });
    expect(screen.getByRole("heading", { level: 1, name: "App verification" })).toBeTruthy();
    expect(window.location.search).toBe("?country=us&category=verification");
    expect(await screen.findByRole("heading", { name: "Test app" })).toBeTruthy();
  });
});

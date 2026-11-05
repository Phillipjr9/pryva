// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";
import { DigitalServicesForm } from "@/app/dashboard/digital/DigitalServicesForm";
import { getDigitalService } from "@/lib/digital-services";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const user = { id: "buyer", name: "Ada", email: "ada@example.test", walletBalance: 50000, emailVerifiedAt: null, createdAt: new Date(0) };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("choosing services", () => {
  it("filters to the chosen category and type, links the exact item, and restores history", async () => {
    window.history.replaceState(null, "", "/dashboard/services");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => ({
      ok: true, json: async () => ({ ok: true, country: new URL(url, window.location.origin).searchParams.get("country"), items: [
        { id: "live-views", category: "social", name: "Instagram views", description: "Supplier listing", tag: "Views", artwork: { kind: "brand", name: "instagram" }, source: "live", coverage: "not-country-specific", stock: null, myUnits: null, price: null, action: { label: "Order", href: "/dashboard/boosts/item" } },
        { id: "live-whatsapp", category: "verification", name: "WhatsApp", description: "Supplier listing", tag: "Messaging", artwork: { kind: "brand", name: "whatsapp" }, source: "live", coverage: "catalog-country", stock: null, myUnits: null, price: null, action: null },
      ] }),
    })));
    render(<ServiceExplorer initialCountry={null} initialCategory={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Nigeria" }));
    fireEvent.click(screen.getByRole("button", { name: "Social promotion" }));
    expect(screen.getByRole("heading", { level: 1, name: "Social promotion" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "WhatsApp" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Views" }));
    const card = (await screen.findByRole("heading", { name: "Instagram views" })).closest("article")!;
    // The only social card is an actual supplier response, not a fabricated entry.
    expect(within(card).getByRole("link", { name: "Order" }).getAttribute("href")).toBe("/dashboard/boosts/item");
    expect(screen.queryByRole("heading", { name: "Instagram followers" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "App verification" }));
    expect(screen.getByRole("heading", { name: "WhatsApp" })).toBeTruthy();
    expect(window.location.search).toBe("?country=ng&category=verification");
    window.history.back();
    await waitFor(() => expect(window.location.search).toBe("?country=ng&category=social"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Social promotion" })).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "WhatsApp" })).toBeNull();
    window.history.forward();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "App verification" })).toBeTruthy());
    expect(screen.getByRole("heading", { name: "WhatsApp" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Number plans" }));
    expect(screen.getByRole("heading", { level: 1, name: "Number plans" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rental" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Single use" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rental" }));
    expect(screen.getAllByRole("heading", { name: "Nigeria rental" })).toHaveLength(3);
    expect(screen.queryByRole("heading", { name: "Nigeria" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Mobile data" }));
    expect(screen.getByRole("heading", { level: 1, name: "Mobile data" })).toBeTruthy();
    expect(screen.getByText("No listings match these filters")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "MTN 1GB" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Airtel 1GB" })).toBeNull();
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

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";
import { DemoServiceCheckout } from "@/components/dashboard/DemoServiceCheckout";
import { DigitalServicesForm } from "@/app/dashboard/digital/DigitalServicesForm";
import { getDigitalService } from "@/lib/digital-services";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/ui/PaymentLoading", () => ({ PaymentLoading: ({ show }: { show: boolean }) => show ? <div>Payment processing</div> : null }));
vi.mock("@/components/ui/PaymentSuccess", () => ({ PaymentSuccess: ({ show, message }: { show: boolean; message: string }) => show ? <div role="status">{message}</div> : null }));

const user = { id: "preview-user", name: "Preview", email: "preview@example.test", walletBalance: 50000, createdAt: new Date(0) };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("choosing services", () => {
  it("filters to the chosen category and type, links the exact item, and restores history", async () => {
    window.history.replaceState(null, "", "/dashboard/services");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => ({
      ok: true, json: async () => ({ ok: true, simulated: true, country: new URL(url, window.location.origin).searchParams.get("country"), inventory: {} }),
    })));
    render(<ServiceExplorer initialCountry={null} initialCategory={null} preview />);
    fireEvent.click(screen.getByRole("button", { name: "Nigeria" }));
    fireEvent.click(screen.getByRole("button", { name: "Social promotion" }));
    expect(screen.getByRole("heading", { level: 1, name: "Social promotion" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "WhatsApp" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Views" }));
    const card = screen.getByRole("heading", { name: "Instagram views" }).closest("article")!;
    expect(within(card).getByRole("link", { name: /Try demo/ }).getAttribute("href")).toBe("/dashboard/services/demo/social-instagram-views?country=ng");
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
  });

  it("never retains another subscription or country as the active plan", () => {
    const { rerender } = render(<DigitalServicesForm user={user} service={getDigitalService("netflix")!} countryCode="ng" preview />);
    fireEvent.click(screen.getByRole("button", { name: /Netflix Premium - 1 Month/ }));
    expect(screen.getByText("Selected Plan")).toBeTruthy();
    rerender(<DigitalServicesForm user={user} service={getDigitalService("spotify")!} countryCode="ng" preview />);
    expect(screen.queryByText("Selected Plan")).toBeNull();
    expect(screen.getByRole("button", { name: "Select a plan" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Spotify Premium - 1 Month/ }));
    expect(screen.getByText("Selected Plan")).toBeTruthy();
    rerender(<DigitalServicesForm user={user} service={getDigitalService("spotify")!} countryCode="gb" preview />);
    expect(screen.queryByText("Selected Plan")).toBeNull();
    expect(screen.getByRole("button", { name: "Select a plan" }).hasAttribute("disabled")).toBe(true);
  });

  it("submits the selected subscription plan with its browsing country", async () => {
    vi.useFakeTimers();
    let complete!: (response: unknown) => void;
    const fetchMock = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DigitalServicesForm user={user} service={getDigitalService("spotify")!} countryCode="gb" preview />);
    fireEvent.click(screen.getByRole("button", { name: /Spotify Premium - 1 Month/ }));
    fireEvent.click(screen.getByRole("button", { name: /Pay .*demo wallet/ }));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(options.body))).toMatchObject({ planId: "spotify-1month", country: "gb", requestId: expect.any(String) });
    await act(async () => {
      complete({ ok: true, json: async () => ({ ok: true, simulated: true, orderId: "demo-order" }) });
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(screen.getByText("This simulated subscription has no real account access.")).toBeTruthy();
  });

  it("submits the exact selected demo item once and waits for a confirmed response", async () => {
    vi.useFakeTimers();
    let complete!: (response: unknown) => void;
    const fetchMock = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DemoServiceCheckout itemId="social-youtube-views" country="gb" name="YouTube views" price={1200} units={100} balance={5000} stock={5000} summary="100 demo views" delivery="Watch this fictional promotion complete in your order." />);
    const pay = screen.getByRole("button", { name: /Pay ₦1,200/ });
    fireEvent.click(pay);
    fireEvent.click(pay);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(options.body))).toMatchObject({ itemId: "social-youtube-views", country: "gb", requestId: expect.any(String) });
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(screen.getByText("Payment processing")).toBeTruthy();
    expect(screen.queryByText(/is ready in your simulated orders/)).toBeNull();
    await act(async () => {
      complete({ ok: true, json: async () => ({ ok: true, simulated: true, orderId: "demo-order", reference: "demo-reference" }) });
      await Promise.resolve();
    });
    expect(screen.getByText("YouTube views is ready in your simulated orders. No real service was purchased.")).toBeTruthy();
  });
});

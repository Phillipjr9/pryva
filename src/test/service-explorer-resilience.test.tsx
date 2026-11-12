// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";
import ServicesError from "@/app/dashboard/services/error";
import type { ExplorerItem } from "@/lib/services/service-explorer";

const key = "pryva:selected-country";
function app(name: string, id: string, country = "us"): ExplorerItem {
  return { id: `otp-${id.padStart(24, "0")}`, category: "verification", name, description: "Live offer", tag: "Other",
    artwork: { kind: "service", name: "numbers" }, source: "live", coverage: "catalog-country",
    stock: 3, myUnits: null, price: 1200, action: { label: "Choose service", href: `/dashboard/services/otp/otp-${id.padStart(24, "0")}?country=${country}` } };
}
function emptyFeeds() {
  return vi.fn(async (url: string) => Response.json({ ok: true, country: new URL(url, "https://example.test").searchParams.get("country"), live: true, items: [] }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("service explorer resilience", () => {
  it("restores a remembered country after hydration without requesting the default country", async () => {
    window.localStorage.setItem(key, "us");
    const fetchMock = emptyFeeds();
    vi.stubGlobal("fetch", fetchMock);
    const element = <ServiceExplorer initialCountry={null} initialCategory="verification" />;
    const html = renderToString(element);
    expect(html).toContain("Restoring your country selection");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(error) }); });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Country of service" })).toHaveProperty("value", "us"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain("country=us&feed=verification");
    expect(window.localStorage.getItem(key)).toBe("us");
    expect(errors).toEqual([]);
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps invalid-link warnings visible after restoring the data category", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ plans: [], checkedAt: "2026-11-12T12:00:00Z", stale: false, checkoutReason: "Checkout is not connected." })));
    render(<ServiceExplorer initialCountry={null} initialCategory="data" rejectedCountry="bad-country" />);
    expect(await screen.findByRole("heading", { name: "Mobile data & airtime" })).toBeTruthy();
    expect(screen.getByText(/bad-country/)).toBeTruthy();
    expect(screen.getByText(/the selection was reset/)).toBeTruthy();
  });

  it("keeps browsing and country selection usable when browser storage is blocked", async () => {
    const fetchMock = emptyFeeds();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    render(<ServiceExplorer initialCountry={null} initialCategory="verification" />);
    const selector = await screen.findByRole("combobox", { name: "Country of service" });
    expect(selector).toHaveProperty("value", "ng");
    fireEvent.click(screen.getByRole("button", { name: "US" }));
    expect(selector).toHaveProperty("value", "us");
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("country=us&feed=verification"))).toBe(true));
    window.history.pushState(null, "", "/dashboard/services?category=verification");
    fireEvent.popState(window);
    expect(selector).toHaveProperty("value", "ng");
  });

  it("keeps an explicit selection when saving to storage fails", async () => {
    vi.stubGlobal("fetch", emptyFeeds());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    expect(screen.getByRole("combobox", { name: "Country of service" })).toHaveProperty("value", "us");
    fireEvent.click(screen.getByRole("button", { name: "Nigeria" }));
    expect(screen.getByRole("combobox", { name: "Country of service" })).toHaveProperty("value", "ng");
  });

  it("keeps valid rows visible, locks unsafe links, and reports malformed rows as incomplete", async () => {
    const safe = app("Healthy app", "1");
    const unsafe = { ...app("Unsafe link", "2"), action: { label: "Choose service", href: "https://outside.example/pay" } };
    const malformed = { ...app("Malformed app", "3"), artwork: null, name: { text: "bad" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, country: "us", live: true, partial: false,
      items: [safe, unsafe, malformed] })));
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    const healthy = (await screen.findByRole("heading", { name: "Healthy app" })).closest("article")!;
    expect(within(healthy).getByRole("link", { name: "Choose service" }).getAttribute("href")).toBe(safe.action?.href);
    const unsafeCard = screen.getByRole("heading", { name: "Unsafe link" }).closest("article")!;
    expect(within(unsafeCard).getByRole("button", { name: "Purchasing locked" })).toHaveProperty("disabled", true);
    expect(screen.queryByText("Malformed app")).toBeNull();
    expect(screen.getByText(/Some live listings could not be loaded/)).toBeTruthy();
    expect(screen.getByText(/Affected: App verification/)).toBeTruthy();
    expect(screen.queryByText(/Live listings are current/)).toBeNull();
  });

  it("offers a recovery screen for a real render error without exposing its raw message", () => {
    const retry = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("private supplier details"), { digest: "abc123" });
    render(<ServicesError error={error} retry={retry} />);
    expect(screen.getByRole("alert").textContent).toContain("We couldn’t load this page");
    expect(screen.getByText("Reference: abc123")).toBeTruthy();
    expect(screen.queryByText(/private supplier details/)).toBeNull();
    expect(JSON.stringify(log.mock.calls)).not.toContain("private supplier details");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Back to dashboard" }).getAttribute("href")).toBe("/dashboard");
  });
});

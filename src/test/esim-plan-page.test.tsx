// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { EsimOffer } from "@/lib/services/esim/esim-catalog";

const findOffer = vi.hoisted(() => vi.fn());
const recheckOffer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/esim/esim-catalog", () => ({ findEsimOffer: findOffer, recheckEsimOffer: recheckOffer, esimOfferTerms: () => "a".repeat(24) }));
vi.mock("@/lib/identity/auth", () => ({ requireUser: async () => ({ walletBalance: 50_000 }) }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not found"); },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import EsimPlanPage from "@/app/dashboard/esim/[id]/page";

function offer(overrides: Partial<EsimOffer> = {}): EsimOffer {
  return {
    id: "live-esim-0123456789abcdef0123",
    planId: "pln_private_reference",
    name: "Nigeria 1GB",
    region: "Africa",
    countries: ["Nigeria"],
    dataLabel: "1GB of data",
    validityLabel: "7 days",
    coverage: "catalog-country",
    includesPhoneNumber: null,
    supportsVoice: null,
    supportsSms: null,
    costNgn: 4_500,
    priceNgn: 6_500,
    purchasable: true,
    ...overrides,
  };
}

async function renderPage(overrides: Partial<EsimOffer> = {}) {
  const plan = offer(overrides);
  findOffer.mockResolvedValue(plan);
  recheckOffer.mockImplementation(async (value) => value);
  const element = await EsimPlanPage({ params: Promise.resolve({ id: plan.id }) });
  return render(element);
}

function feature(label: string) {
  return within(screen.getByText(label, { selector: "dt" }).parentElement!);
}

afterEach(() => {
  cleanup();
  findOffer.mockReset();
  recheckOffer.mockReset();
  vi.unstubAllGlobals();
});

describe("eSIM plan information before purchase", () => {
  it("clearly says exact number selection is unavailable and leaves unknown capabilities unknown", async () => {
    const { container } = await renderPage();
    expect(screen.getByText(/You cannot choose a specific phone number before buying/)).toBeTruthy();
    expect(screen.getByText(/listing did not confirm the feature/)).toBeTruthy();
    expect(screen.getByText(/A specific phone number cannot be selected for this eSIM/)).toBeTruthy();
    expect(feature("Phone number").getByText("Not specified")).toBeTruthy();
    expect(feature("Calls").getByText("Not specified")).toBeTruthy();
    expect(feature("SMS").getByText("Not specified")).toBeTruthy();
    expect(screen.getByRole("link", { name: "contact support" }).getAttribute("href")).toBe("/contact");
    expect(screen.getByRole("button", { name: /Buy Nigeria 1GB/ })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(container.textContent).not.toMatch(/data-only|usual number stays active/i);
    expect(container.textContent).not.toContain("pln_private_reference");
    expect(container.textContent).not.toContain("4,500");
  });

  it("classifies explicitly call-and-text capable and internet-only plans", async () => {
    const callsAndTexts = await renderPage({ supportsVoice: true, supportsSms: true });
    expect(screen.getByText("Plan type: Calls & texts")).toBeTruthy();
    callsAndTexts.unmount();
    cleanup();

    await renderPage({ supportsVoice: false, supportsSms: false });
    expect(screen.getByText("Plan type: Internet only")).toBeTruthy();
  });

  it("shows a temporary failure rather than a not-found page when the catalogue read fails", async () => {
    findOffer.mockRejectedValue(new Error("down"));
    render(await EsimPlanPage({ params: Promise.resolve({ id: "live-esim-0123456789abcdef0123" }) }));
    expect(screen.getByText(/couldn't load this plan right now/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Buy/ })).toBeNull();
  });

  it("shows freshly confirmed plan details and pauses ordering if confirmation fails", async () => {
    findOffer.mockResolvedValue(offer());
    recheckOffer.mockResolvedValue({ ...offer(), dataLabel: "2GB of data", priceNgn: 7_000 });
    render(await EsimPlanPage({ params: Promise.resolve({ id: "live-esim-0123456789abcdef0123" }) }));
    expect(screen.getAllByText(/2GB of data/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Buy Nigeria 1GB/ }).textContent).toContain("7,000");
    cleanup();

    recheckOffer.mockRejectedValue(new Error("down"));
    render(await EsimPlanPage({ params: Promise.resolve({ id: "live-esim-0123456789abcdef0123" }) }));
    expect(screen.getByText(/could not be confirmed/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Buy Nigeria 1GB/ })).toBeNull();
  });

  it("confirms the displayed price and keeps the same request key on a retry", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ ok: false, error: "The price changed. Reload this plan to review the new price before buying." }),
      { status: 409, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Buy Nigeria 1GB/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/price changed/i));
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(first).toMatchObject({ offerId: "live-esim-0123456789abcdef0123", expectedPriceNgn: 6_500, expectedTerms: "a".repeat(24) });
    expect(first.requestId).toMatch(/^[a-f0-9-]{36}$/i);
    fireEvent.click(screen.getByRole("button", { name: /Buy Nigeria 1GB/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestId).toBe(first.requestId);
  });

  it("shows reported features without promising number delivery or free calls", async () => {
    await renderPage({ includesPhoneNumber: true, supportsVoice: false, supportsSms: true });
    expect(feature("Phone number").getByText("Listed as included")).toBeTruthy();
    expect(feature("Calls").getByText("Listed as not supported")).toBeTruthy();
    expect(feature("SMS").getByText("Listed as supported")).toBeTruthy();
    expect(screen.getByText(/not confirmed how an included number is provided or any call and SMS charges/)).toBeTruthy();
    expect(screen.getByText(/You cannot choose a specific phone number before buying/)).toBeTruthy();
  });

  it("distinguishes a reported absence from an unknown", async () => {
    await renderPage({ includesPhoneNumber: false, supportsVoice: true, supportsSms: null });
    expect(feature("Phone number").getByText("Listed as not included")).toBeTruthy();
    expect(feature("Calls").getByText("Listed as supported")).toBeTruthy();
    expect(feature("SMS").getByText("Not specified")).toBeTruthy();
  });
});

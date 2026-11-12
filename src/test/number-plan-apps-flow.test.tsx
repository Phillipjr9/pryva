// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextRequest } from "next/server";

vi.mock("@/lib/identity/auth", async (original) => {
  const actual = await original<typeof import("@/lib/identity/auth")>();
  return { ...actual, getCurrentUser: async () => ({ id: "catalogue-test-user" }) };
});
vi.mock("@/lib/platform/financial-environment", async (original) => {
  const actual = await original<typeof import("@/lib/platform/financial-environment")>();
  return { ...actual, financialActionsUnavailable: () => false };
});
vi.mock("@/lib/platform/rate-limit", async (original) => {
  const actual = await original<typeof import("@/lib/platform/rate-limit")>();
  return { ...actual, catalogRateLimiter: async () => ({ allowed: true }) };
});

import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";
import { GET } from "@/app/api/services/catalog/route";
import { clearOtpCatalogueCache } from "@/lib/services/numbers/otp-suppliers";

beforeEach(() => {
  clearOtpCatalogueCache();
  vi.stubEnv("BITCALL_KEY_ID", "ak_test_flow");
  vi.stubEnv("BITCALL_API_SECRET", "ab".repeat(64));
  vi.stubEnv("VERCEL_ENV", "");
});
afterEach(() => { cleanup(); clearOtpCatalogueCache(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); window.localStorage.clear(); });

it("takes the documented provider catalogue through the customer feed into Number plans without a purchase", async () => {
  const upstream: Array<{ path: string; method: string; country: string | null }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://pryva.test");
    if (url.origin === "https://pryva.test") {
      if (url.searchParams.get("feed") === "verification") return GET(new NextRequest(url));
      return Response.json({ ok: true, country: url.searchParams.get("country"), live: true, items: [] });
    }
    const method = init?.method ?? "GET";
    upstream.push({ path: url.pathname, method, country: url.searchParams.get("country_code") });
    if (method !== "GET") throw new Error("This test must never make a paid call");
    if (url.pathname === "/v1/otp/countries") return Response.json({
      data: [{ countryCode: "US_1", name: "United States (Virtual)" }],
      meta: { page: 1, total: 1, totalPages: 1, hasNext: false },
    });
    if (url.pathname === "/v1/otp/services") return Response.json({
      data: [
        { name: "Call of Duty Mobile", slug: "cod-mobile", pools: [{ serviceId: "private-cod-us", price: { amount: 100, currency: "NGN" }, availableCount: 5 }] },
        { name: "WhatsApp", slug: "whatsapp", pools: [{ serviceId: "private-whatsapp-us", price: { amount: 100, currency: "NGN" }, availableCount: 7 }] },
      ],
      meta: { page: 1, total: 2, totalPages: 1, hasNext: false },
    });
    throw new Error(`Unexpected gateway path: ${url.pathname}`);
  }));

  render(<ServiceExplorer initialCountry="us" initialCategory="numbers" />);
  const section = screen.getByRole("region", { name: "Apps for single-use numbers" });
  expect(await within(section).findByRole("button", { name: /Call of Duty Mobile.*1 option/ })).toBeTruthy();
  expect(within(section).getByRole("button", { name: /WhatsApp.*1 option/ })).toBeTruthy();
  expect(within(section).getByRole("link", { name: "Choose service" }).getAttribute("href"))
    .toMatch(/^\/dashboard\/services\/otp\/otp-[a-f0-9]{24}\?country=us&from=numbers$/);
  expect(section.textContent).not.toContain("private-cod-us");
  expect(upstream).toContainEqual({ path: "/v1/otp/services", method: "GET", country: "US_1" });
  expect(upstream.every(({ method }) => method === "GET")).toBe(true);
});

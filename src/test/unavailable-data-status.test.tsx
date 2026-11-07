import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StatusPage from "@/app/(site)/status/page";

vi.mock("@/lib/identity/auth", () => ({
  requireAuthApi: vi.fn().mockResolvedValue({ id: "user-1", walletBalance: 0 }),
  getCurrentUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));

vi.mock("@/lib/providers/fleexa", () => ({
  isFleexaConfigured: vi.fn(() => false),
  listFleexaDataPlans: vi.fn(() => []),
  buyFleexaData: vi.fn(),
  listFleexaProxyPlans: vi.fn(() => []),
  buyFleexaProxy: vi.fn(),
  listFleexaSubscriptionPlans: vi.fn(() => []),
  buyFleexaSubscription: vi.fn(),
}));

afterEach(() => vi.unstubAllEnvs());

describe("unavailable services", () => {
  it("returns 503 when Fleexa is not configured", async () => {
    const { GET } = await import("@/app/api/airtime/plans/route");
    const response = await GET(
      new Request("http://localhost/api/airtime/plans", {
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toHaveProperty("error");
  });

  it("does not claim subscriptions or data have a verified ordering integration", () => {
    vi.stubEnv("DATABASE_URL", "postgres://mock.invalid/db");
    vi.stubEnv("VERCEL_ENV", "production");
    const html = renderToStaticMarkup(<StatusPage />);
    expect(html).toContain("Digital subscriptions and mobile data");
    expect(html).toContain("Ordering is not connected for these categories");
    expect(html).not.toContain(
      "Orders are processed automatically through verified provider integration",
    );
  });

  it("does not claim gift cards or number orders are available in Vercel preview", () => {
    vi.stubEnv("DATABASE_URL", "postgres://mock.invalid/db");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("FLEEXA_API_KEY", "test-only");
    const html = renderToStaticMarkup(<StatusPage />);
    expect(html).toContain("Gift-card purchases and redemption are unavailable in this environment.");
    expect(html).not.toContain("plans have a configured ordering path");
  });
});

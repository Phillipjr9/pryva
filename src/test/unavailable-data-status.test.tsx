import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StatusPage from "@/app/(site)/status/page";
const auth = vi.hoisted(() => ({ current: vi.fn() }));
vi.mock("@/lib/identity/auth", () => ({ requireAuthApi: auth.current }));
import { GET as dataPlans } from "@/app/api/airtime/plans/route";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { beginPurchase } from "@/lib/checkout/purchase";
import { catalogRateLimiter, cleanupRateLimitStore } from "@/lib/platform/rate-limit";

afterEach(() => vi.unstubAllEnvs());

describe("unavailable services", () => {
  it("does not publish an unverified static data catalogue through the API", async () => {
    auth.current.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "user" });
    const unauthenticated = await dataPlans();
    expect(unauthenticated.status).toBe(401);
    const response = await dataPlans();
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("plans");
  });

  it("does not claim subscriptions or data have a verified ordering integration", () => {
    vi.stubEnv("DATABASE_URL", "postgres://mock.invalid/db");
    vi.stubEnv("VERCEL_ENV", "production");
    const html = renderToStaticMarkup(<StatusPage />);
    expect(html).toContain("Digital subscriptions and mobile data");
    expect(html).toContain("Ordering is not connected for these categories");
    expect(html).not.toContain("Orders are processed automatically through verified provider integration");
  });

  it("does not claim gift cards or number orders are available in Vercel preview", () => {
    vi.stubEnv("DATABASE_URL", "postgres://mock.invalid/db");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("FLEEXA_API_KEY", "test-only");
    const html = renderToStaticMarkup(<StatusPage />);
    expect(html).toContain("Gift-card purchases and redemption are unavailable in this environment.");
    expect(html).not.toContain("plans have a configured ordering path");
  });

  it.each(["1", "true", "yes"])("does not let the listings override bypass the Vercel preview guard (%s)", (override) => {
    vi.stubEnv("DATABASE_URL", "postgres://mock.invalid/db");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("FORCE_LIVE_LISTINGS", override);
    expect(financialActionsUnavailable()).toBe(true);
  });

  it("refuses preview checkout before opening a supplier even when the listings override is set", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://mock.invalid/db");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("FORCE_LIVE_LISTINGS", "1");
    auth.current.mockResolvedValueOnce({ id: "preview-user" });
    const supplier = vi.fn(() => true);
    const request = new Request("https://pryva.test/api/orders", {
      method: "POST",
      headers: { origin: "https://pryva.test", "content-type": "application/json" },
      body: "{}",
    });
    const result = await beginPurchase(request, { bucket: "preview-test", supplierGate: { open: supplier, message: "unavailable" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
    expect(supplier).not.toHaveBeenCalled();
  });

  it("still blocks an unconfigured production database despite the listings override", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGHOST", "");
    vi.stubEnv("PGUSER", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AWS_ROLE_ARN", "");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("FORCE_LIVE_LISTINGS", "1");
    expect(financialActionsUnavailable()).toBe(true);
  });

  it("keeps the existing override available to local development", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGHOST", "");
    vi.stubEnv("PGUSER", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AWS_ROLE_ARN", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("FORCE_LIVE_LISTINGS", "1");
    expect(financialActionsUnavailable()).toBe(false);
  });

  it("does not mark preview rate-limit overflow as a provider outage", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGHOST", "");
    vi.stubEnv("PGUSER", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AWS_ROLE_ARN", "");
    cleanupRateLimitStore();

    let sawUnavailable = false;
    for (let i = 0; i < 10_001; i++) {
      const result = await catalogRateLimiter(`overflow-${i}`);
      if (result.unavailable) {
        sawUnavailable = true;
        break;
      }
    }

    expect(sawUnavailable).toBe(false);
    cleanupRateLimitStore();
  });
});

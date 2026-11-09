import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StatusPage from "@/app/(site)/status/page";
const auth = vi.hoisted(() => ({ current: vi.fn() }));
vi.mock("@/lib/identity/auth", () => ({ requireAuthApi: auth.current }));
import { GET as dataPlans } from "@/app/api/airtime/plans/route";

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
});

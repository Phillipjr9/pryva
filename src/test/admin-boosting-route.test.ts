// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The admin readiness probe. It answers one operational question ("will a boost
 * actually be sold right now?") with read-only supplier calls, so the checks are
 * about what it is allowed to reveal and what it must survive.
 */

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  configured: vi.fn(),
  endpoint: vi.fn(),
  balance: vi.fn(),
  services: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ authorizeAdminApi: mocks.admin }));
vi.mock("@/lib/smm-panel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/smm-panel")>();
  return {
    ...actual,
    isSmmPanelConfigured: mocks.configured,
    panelEndpoint: mocks.endpoint,
    getSmmBalance: mocks.balance,
    listSmmServices: mocks.services,
  };
});

import { GET } from "@/app/api/admin/boosting/route";
import { SmmPanelError } from "@/lib/smm-panel";

const SERVICE = {
  id: "svc-1",
  name: "Instagram Followers",
  category: "Instagram - Followers",
  type: "Default",
  ratePer1000: 1000,
  currency: "NGN",
  min: 100,
  max: 50_000,
  refill: true,
  cancel: true,
  dripfeed: false,
};

function request() {
  return new NextRequest("https://pryva.test/api/admin/boosting", {
    headers: { host: "pryva.test", "x-forwarded-proto": "https" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SMM_USD_NGN_RATE;
  delete process.env.SMM_MARKUP_PERCENT;
  mocks.admin.mockResolvedValue({ response: null, user: { id: "admin-1" } });
  mocks.configured.mockReturnValue(true);
  mocks.endpoint.mockReturnValue("https://panel.example/api/v2");
  mocks.balance.mockResolvedValue({ balance: 42.5, currency: "NGN" });
  mocks.services.mockResolvedValue([SERVICE]);
});

afterEach(() => {
  delete process.env.SMM_USD_NGN_RATE;
  delete process.env.SMM_PANEL_API_KEY;
});

describe("GET /api/admin/boosting", () => {
  it("refuses anyone who is not an operator", async () => {
    mocks.admin.mockResolvedValueOnce({ response: new Response("no", { status: 403 }) });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.services).not.toHaveBeenCalled();
  });

  it("says boosting is off without calling the supplier at all", async () => {
    mocks.configured.mockReturnValue(false);
    const data = (await (await GET(request())).json()) as { configured: boolean; services: number; hint: string };
    expect(data.configured).toBe(false);
    expect(data.services).toBe(0);
    expect(data.hint).toContain("SMM_PANEL_API_KEY");
    expect(mocks.balance).not.toHaveBeenCalled();
    expect(mocks.services).not.toHaveBeenCalled();
  });

  it("reports a priced naira catalogue", async () => {
    const response = await GET(request());
    const data = (await response.json()) as Record<string, unknown>;
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(data).toMatchObject({
      ok: true,
      configured: true,
      reachable: true,
      currency: "NGN",
      balance: 42.5,
      services: 1,
      listed: 1,
      markupPercent: 35,
      endpointHost: "panel.example",
    });
  });

  it("explains that a USD panel with no rate cannot be sold", async () => {
    mocks.balance.mockResolvedValue({ balance: 10, currency: "USD" });
    mocks.services.mockResolvedValue([{ ...SERVICE, currency: "USD", ratePer1000: 2 }]);
    const data = (await (await GET(request())).json()) as { listed: number; hint: string; currency: string; reachable: boolean };
    expect(data.currency).toBe("USD");
    expect(data.listed).toBe(0);
    expect(data.reachable).toBe(true);
    expect(data.hint).toContain("SMM_USD_NGN_RATE");
  });

  it("prices a USD panel once a rate exists", async () => {
    process.env.SMM_USD_NGN_RATE = "1600";
    mocks.balance.mockResolvedValue({ balance: 10, currency: "USD" });
    mocks.services.mockResolvedValue([{ ...SERVICE, currency: "USD", ratePer1000: 2 }]);
    const data = (await (await GET(request())).json()) as { listed: number; fxRate: number; hint: string };
    expect(data.fxRate).toBe(1600);
    expect(data.listed).toBe(1);
    expect(data.hint).toContain("test order");
  });

  it("survives a supplier that refuses, without a 500 or a stack trace", async () => {
    mocks.balance.mockRejectedValue(new SmmPanelError("invalid key", 502, "BAD_KEY"));
    const response = await GET(request());
    expect(response.status).toBe(200);
    const data = (await response.json()) as { reachable: boolean; error: string; services: number };
    expect(data.reachable).toBe(false);
    expect(data.error).toContain("invalid key");
    // The catalogue read is independent: one failing call must not hide the other.
    expect(data.services).toBe(1);
  });

  it("turns an unexpected crash into one sentence", async () => {
    mocks.balance.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.4:443"));
    const data = (await (await GET(request())).json()) as { error: string };
    expect(data.error).not.toContain("ECONNREFUSED");
    expect(data.error).toContain("balance check");
  });

  it("never echoes the supplier key", async () => {
    process.env.SMM_PANEL_API_KEY = "super-secret-panel-key";
    const text = await (await GET(request())).text();
    expect(text).not.toContain("super-secret-panel-key");
    expect(text).not.toContain("ratePer1000");
  });
});

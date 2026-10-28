import { afterEach, describe, expect, it, vi } from "vitest";
import { findPlan } from "@/lib/catalog";
import { fulfillPlan } from "@/lib/fulfillment";

const preview = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: () => preview.enabled }));

afterEach(() => {
  preview.enabled = true;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("fulfilment safety", () => {
  it("simulates orders only for an in-memory preview without contacting a provider", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const plan = findPlan("vn-ng");
    expect(plan).toBeDefined();
    // Legacy mappings silently routed some countries to different countries.
    expect(plan).not.toHaveProperty("provider");
    const result = await fulfillPlan(plan!);
    expect(result.provider).toBe("simulated");
    expect(result.providerRequestId).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed for a real database even when a provider key is present", async () => {
    preview.enabled = false;
    vi.stubEnv("FLEEXA_API_KEY", "configured-key");
    const fetch = vi.spyOn(globalThis, "fetch");
    const plan = findPlan("vn-ng");
    await expect(fulfillPlan(plan!)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

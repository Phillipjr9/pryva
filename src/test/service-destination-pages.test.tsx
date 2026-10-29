import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DigitalServicesPage from "@/app/dashboard/digital/page";
import DataPlansPage from "@/app/dashboard/data/page";
import { buildServiceExplorer } from "@/lib/service-explorer";

const user = { id: "preview-user", name: "Preview", email: "preview@example.test", walletBalance: 5000, createdAt: new Date(0) };
vi.mock("@/lib/auth", () => ({ requireUser: async () => user }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  useRouter: () => ({ push: vi.fn() }),
}));

describe("service destinations", () => {
  it("opens only the selected subscription and retains country on links", async () => {
    const action = buildServiceExplorer("ng").find((item) => item.id === "subscription-spotify")!.action!;
    expect(action.href).toBe("/dashboard/digital?service=spotify&country=ng");
    const markup = renderToStaticMarkup(await DigitalServicesPage({ searchParams: Promise.resolve({ service: "spotify", country: "ng" }) }));
    expect(markup).toContain("Spotify Premium - 1 Month");
    expect(markup).not.toContain("Netflix Premium - 1 Month");
    expect(markup).toContain("Browsing for Nigeria");
    expect(markup).toContain("does not confirm real coverage");
    expect(markup).toContain("/dashboard/services?country=ng&amp;category=subscriptions");
    expect(markup).toContain("/dashboard/digital?country=ng");
    const all = renderToStaticMarkup(await DigitalServicesPage({ searchParams: Promise.resolve({ country: "ng" }) }));
    expect(all).toContain("/dashboard/digital?service=netflix&amp;country=ng");
  });

  it("does not fall back to an unrelated subscription or data plan for invalid links", async () => {
    for (const query of [{ service: "unknown" }, { service: ["spotify", "netflix"] }, { country: "unknown" }, { country: ["ng", "us"] }]) {
      await expect(DigitalServicesPage({ searchParams: Promise.resolve(query) })).rejects.toThrow("NOT_FOUND");
    }
    for (const query of [{ plan: "unknown" }, { plan: ["mtn-1gb", "airtel-1gb"] }]) {
      await expect(DataPlansPage({ searchParams: Promise.resolve(query) })).rejects.toThrow("NOT_FOUND");
    }
    const data = renderToStaticMarkup(await DataPlansPage({ searchParams: Promise.resolve({ plan: "airtel-1gb" }) }));
    expect(data).toContain("Airtel 1GB");
    expect(data).not.toContain("MTN 1GB");
  });
});

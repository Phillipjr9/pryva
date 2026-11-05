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
  it("shows subscriptions as unavailable without invented prices or listings", async () => {
    expect(buildServiceExplorer("ng").filter((item) => item.category === "subscriptions")).toEqual([]);
    const markup = renderToStaticMarkup(await DigitalServicesPage());
    expect(markup).toContain("Subscriptions are not currently available to order");
    expect(markup).not.toContain("Spotify Premium - 1 Month");
    expect(markup).not.toContain("Netflix Premium - 1 Month");
  });

  it("does not fall back to an unrelated data plan for invalid links", async () => {
    for (const query of [{ plan: "unknown" }, { plan: ["mtn-1gb", "airtel-1gb"] }]) {
      await expect(DataPlansPage({ searchParams: Promise.resolve(query) })).rejects.toThrow("NOT_FOUND");
    }
    const data = renderToStaticMarkup(await DataPlansPage({ searchParams: Promise.resolve({ plan: "airtel-1gb" }) }));
    expect(data).toContain("Data plans are not available yet");
    expect(data).not.toContain("Airtel 1GB");
    expect(data).not.toContain("MTN 1GB");
  });
});

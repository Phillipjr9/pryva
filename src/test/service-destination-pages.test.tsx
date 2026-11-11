import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DigitalServicesPage from "@/app/dashboard/digital/page";
import DataPlansPage from "@/app/dashboard/data/page";
import { buildServiceExplorer } from "@/lib/services/service-explorer";

const user = { id: "preview-user", name: "Preview", email: "preview@example.test", walletBalance: 5000, createdAt: new Date(0) };
vi.mock("@/lib/identity/auth", () => ({ requireUser: async () => user }));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
  useRouter: () => ({ push: vi.fn() }),
}));

describe("service destinations", () => {
  it("directs subscriptions to the shared category without inventing prices or listings", async () => {
    expect(buildServiceExplorer("ng").filter((item) => item.category === "subscriptions")).toEqual([]);
    expect(() => DigitalServicesPage()).toThrow("REDIRECT:/dashboard/services?category=subscriptions");
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

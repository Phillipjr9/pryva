import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { DataPlansForm } from "@/app/dashboard/data/DataPlansForm";
import { DigitalServicesForm } from "@/app/dashboard/digital/DigitalServicesForm";
import { getDigitalService } from "@/lib/digital-services";

const mocks = vi.hoisted(() => ({ listListings: vi.fn(), price: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/accszone", () => ({
  isAccsZoneConfigured: () => true,
  listListings: mocks.listListings,
  AccsZoneError: class AccsZoneError extends Error { code = "error"; status = 502; },
}));
vi.mock("@/lib/marketplace-pricing", () => ({ priceMarketplaceListing: mocks.price }));

const user = { id: "preview-user", name: "Preview", email: "preview@example.test", walletBalance: 5000, createdAt: new Date(0) };

beforeEach(() => {
  mocks.listListings.mockReset();
  mocks.price.mockReset();
});

describe("service hub destination pages", () => {
  it("opens the selected data plan and network rather than silently defaulting to MTN", () => {
    const html = renderToStaticMarkup(<DataPlansForm user={user} initialPlanId="airtel-1gb" preview />);
    expect(html).toContain("Airtel 1GB");
    expect(html).not.toContain("MTN 1GB");
    expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?Airtel 1GB/);
    expect(html).toContain("Demo stock");
    expect(html).toContain("My demo units");
    expect(html).toContain("No phone number is needed");
  });

  it("keeps data and subscription purchases disabled outside preview", () => {
    const data = renderToStaticMarkup(<DataPlansForm user={user} preview={false} />);
    expect(data).toContain("Live data purchases paused");
    const digital = renderToStaticMarkup(<DigitalServicesForm user={user} service={getDigitalService("netflix")!} preview={false} />);
    expect(digital).toContain("Live purchases paused");
    expect(digital).toContain("Not tracked");
    expect(digital).not.toContain("Save 51% vs monthly");
  });
});

describe("marketplace supplier inventory", () => {
  it("returns validated stock, distinguishing malformed values from actual zero, without supplier costs", async () => {
    mocks.listListings.mockResolvedValue({
      listings: [12, null, 0, -1, "7"].map((available_stock, index) => ({
        id: index + 1, slug: `listing-${index}`, title: `Listing ${index}`, price: "1.23", available_stock,
        sold: 0, category: null, subcategory: null,
      })),
      meta: { current_page: 1, last_page: 1, per_page: 20, total: 5 },
    });
    mocks.price.mockResolvedValue({ unitNgn: 2500 });
    const { GET } = await import("@/app/api/accounts/listings/route");
    const response = await GET(new NextRequest("http://localhost/api/accounts/listings"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.listings.map((listing: { stock: number | null }) => listing.stock)).toEqual([12, null, 0, null, null]);
    expect(body.listings[0]).toMatchObject({ priceNgn: 2500 });
    expect(body.listings[0]).not.toHaveProperty("price");
  });
});

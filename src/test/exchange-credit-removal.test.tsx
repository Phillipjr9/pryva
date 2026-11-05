import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = vi.hoisted(() => ({
  offer: {
    id: "live-esim-fixture", name: "Nigeria data", region: "Nigeria", countries: ["Nigeria"],
    dataLabel: "1GB of data", validityLabel: "7 days", coverage: "catalog-country",
    includesPhoneNumber: null, supportsVoice: false, supportsSms: false,
    priceNgn: 2500, purchasable: true,
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => { throw new Error("not found"); },
}));
vi.mock("@/lib/identity/auth", () => ({ requireUser: async () => ({ walletBalance: 5000 }) }));
vi.mock("@/lib/services/esim/esim-catalog", () => ({
  ESIM_CATALOGUE_LIMIT: 1000,
  readEsimCatalog: async () => ({ listings: [fixture.offer], fetchedAt: null, partial: false, stats: null }),
  catalogueItems: () => [],
  findEsimOffer: async () => fixture.offer,
  recheckEsimOffer: async () => fixture.offer,
  esimOfferTerms: () => "fixture-terms",
}));

import { AccountsBrowser } from "@/app/(site)/accounts/AccountsBrowser";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";
import EsimCataloguePage from "@/app/dashboard/esim/page";
import EsimPlanPage from "@/app/dashboard/esim/[id]/page";

function expectNoCredit(html: string) {
  expect(html).not.toContain("Rates By Exchange Rate API");
  expect(html).not.toContain('href="https://www.exchangerate-api.com"');
}

describe("exchange-rate credits", () => {
  it("does not display the provider link in the shared marketplace browser", () => {
    expectNoCredit(renderToStaticMarkup(<AccountsBrowser purchaseEnabled={true} />));
  });

  it("does not display the link on the service explorer", () => {
    const html = renderToStaticMarkup(<ServiceExplorer initialCountry="ng" initialCategory="esim" />);
    expect(html).toContain("Stock means available inventory");
    expectNoCredit(html);
  });

  it("does not display the link on eSIM catalogue or plan pages", async () => {
    const catalog = renderToStaticMarkup(await EsimCataloguePage());
    const plan = renderToStaticMarkup(await EsimPlanPage({ params: Promise.resolve({ id: fixture.offer.id }) }));
    expect(catalog).toContain("eSIM plans");
    expect(plan).toContain("Nigeria data");
    expectNoCredit(catalog);
    expectNoCredit(plan);
  });

  it.each([
    "src/app/(site)/accounts/AccountsBrowser.tsx",
    "src/components/dashboard/ServiceExplorer.tsx",
    "src/app/dashboard/esim/page.tsx",
    "src/app/dashboard/esim/[id]/page.tsx",
  ])("keeps the provider credit off %s", (file) => {
    const source = readFileSync(file, "utf8");
    expectNoCredit(source);
  });
});

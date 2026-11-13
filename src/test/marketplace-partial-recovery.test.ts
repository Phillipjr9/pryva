import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  primaryError: false,
  primarySkipped: 0,
  secondaryError: false,
  primaryGate: null as Promise<void> | null,
  primaryReads: 0,
  secondaryReads: 0,
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/platform/logger", () => ({ logger: state.logger }));
vi.mock("@/lib/services/accounts/marketplace-policy", () => ({ isMarketplaceCheckoutConfigured: () => true }));
vi.mock("@/lib/services/accounts/marketplace-pricing", () => ({ priceMarketplaceListing: async () => ({ unitNgn: 500 }) }));
vi.mock("@/lib/providers/bulkacc", () => ({
  BulkaccError: class BulkaccError extends Error {},
  isBulkaccConfigured: () => true,
  isAmbiguousOutcome: () => false,
  readBulkaccCatalog: async () => {
    state.primaryReads++;
    if (state.primaryGate) await state.primaryGate;
    if (state.primaryError) throw new Error("private primary failure");
    return { partial: state.primarySkipped > 0, skipped: state.primarySkipped, checkedAt: new Date().toISOString(), products: [{
      code: "100", name: "Facebook account", groupName: "Facebook", categoryName: "Facebook",
      inStock: 12, min: 1, priceUsd: "1.000000",
    }] };
  },
  productPriceUsd: (product: { priceUsd: string }) => product.priceUsd,
  getProduct: vi.fn(), ensureSufficientBalance: vi.fn(), createOrder: vi.fn(), getOrderAccounts: vi.fn(),
}));
vi.mock("@/lib/providers/accszone", () => ({
  AccsZoneError: class AccsZoneError extends Error {},
  isAccsZoneConfigured: () => true,
  listListings: async () => {
    state.secondaryReads++;
    if (state.secondaryError) throw new Error("private secondary failure");
    return { listings: [{
      id: 7, slug: "instagram-test", title: "Instagram account", price: "0.44", available_stock: 8,
      sold: 3, category: { id: 1, title: "Instagram", slug: "instagram" }, subcategory: null,
    }], meta: { current_page: 1, last_page: 1, per_page: 24, total: 1 } };
  },
  getListing: vi.fn(), purchaseAccounts: vi.fn(),
}));

import { clearMarketplaceCatalogCache } from "@/lib/services/accounts/marketplace-suppliers";
import { readAccountListings } from "@/lib/services/accounts/catalogue-display";
import { GET as getListings } from "@/app/api/accounts/listings/route";
import { GET as getCategories } from "@/app/api/accounts/categories/route";

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
function listingRequest() { return new NextRequest("https://pryva.test/api/accounts/listings?inStock=true&sort=total_price"); }
function categoryRequest() { return new NextRequest("https://pryva.test/api/accounts/categories"); }
async function rows() { return database.select().from(schema.catalogSnapshots); }

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(await readFile("migrations/0045_shared_catalog_snapshots.sql", "utf8"));
  database = drizzle(pg, { schema });
  state.db = database;
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
  state.primaryError = false; state.primarySkipped = 0; state.secondaryError = false; state.primaryGate = null;
  state.primaryReads = 0; state.secondaryReads = 0;
  clearMarketplaceCatalogCache();
  await database.delete(schema.catalogSnapshots);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("account catalogue partial recovery through the shared database", () => {
  it("serves a labelled healthy source without publishing it as the complete snapshot, then recovers", async () => {
    state.primaryError = true;
    const [listingResponse, categoryResponse] = await Promise.all([getListings(listingRequest()), getCategories(categoryRequest())]);
    expect(listingResponse.status).toBe(200);
    expect(categoryResponse.status).toBe(200);
    const partial = await listingResponse.json();
    expect(partial).toMatchObject({ configured: true, partial: true, stale: false, listings: [{ slug: "p2:instagram-test", stock: 8, purchasable: true }] });
    expect(readAccountListings(partial)).toMatchObject({ incomplete: true, listings: [{ title: "Instagram account", purchasable: true }] });
    expect(await categoryResponse.json()).toMatchObject({ partial: true });
    expect(state.primaryReads).toBe(1);
    expect(state.secondaryReads).toBe(1);
    const initialRows = await rows();
    expect(initialRows.find((row) => row.key === "accounts:v2:true:true")?.payload).toBeNull();
    expect(initialRows.find((row) => row.key === "accounts:candidate:v1:true:true")?.payload).toMatchObject({ catalog: { partial: true } });
    expect(JSON.stringify(partial)).not.toMatch(/private|primary|secondary|priceUsd/i);
    expect(JSON.stringify(state.logger.warn.mock.calls)).not.toContain("private primary failure");

    // Another instance may hold the still-empty complete-catalogue lease. A
    // cached partial response must remain available without a 30-second wait.
    await pg.exec(`UPDATE catalog_snapshots SET lease_owner = '${randomUUID()}', lease_expires_at = now() + interval '1 minute' WHERE key = 'accounts:v2:true:true'`);
    let contended: { partial: boolean };
    try { contended = await (await getListings(listingRequest())).json(); }
    finally { await pg.exec("UPDATE catalog_snapshots SET lease_owner = NULL, lease_expires_at = NULL WHERE key = 'accounts:v2:true:true'"); }
    expect(contended.partial).toBe(true);
    expect(state.primaryReads).toBe(1);
    expect(state.secondaryReads).toBe(1);

    state.primaryError = false;
    let release!: () => void;
    state.primaryGate = new Promise<void>((resolve) => { release = resolve; });
    await pg.exec("UPDATE catalog_snapshots SET refreshed_at = now() - interval '31 seconds' WHERE key = 'accounts:candidate:v1:true:true'");
    // A stale partial candidate remains labelled while the shared refresh runs.
    let transition: { partial: boolean; stale: boolean };
    try { transition = await (await getListings(listingRequest())).json(); }
    finally { release(); }
    expect(transition.partial).toBe(true);
    expect(transition.stale).toBe(true);
    await vi.waitFor(async () => {
      const candidate = (await rows()).find((row) => row.key === "accounts:candidate:v1:true:true");
      expect(candidate?.payload).toMatchObject({ catalog: { partial: false } });
      expect(candidate?.leaseOwner).toBeNull();
    });
    const recovered = await (await getListings(listingRequest())).json();
    expect(recovered).toMatchObject({ partial: false, stale: false });
    expect(recovered.listings.map((listing: { title: string }) => listing.title).sort()).toEqual(["Facebook account", "Instagram account"]);
    expect(readAccountListings(recovered)?.incomplete).toBe(false);
    expect((await rows()).find((row) => row.key === "accounts:v2:true:true")?.payload).toMatchObject({ partial: false });
  });

  it("serves a completed walk with rejected rows as partial without publishing it as complete", async () => {
    state.primarySkipped = 1;
    state.secondaryError = true;
    const response = await getListings(listingRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ partial: true, listings: [{ slug: "p1:100" }] });
    const current = await rows();
    expect(current.find((row) => row.key === "accounts:v2:true:true")?.payload).toBeNull();
    expect(current.find((row) => row.key === "accounts:candidate:v1:true:true")?.payload).toMatchObject({ catalog: { partial: true } });
  });

  it("never overwrites a last complete snapshot when a later source fails", async () => {
    const initial = await (await getListings(listingRequest())).json();
    expect(initial).toMatchObject({ partial: false, stale: false });
    const before = (await rows()).find((row) => row.key === "accounts:v2:true:true")?.payload;
    state.secondaryError = true;
    await pg.exec("UPDATE catalog_snapshots SET refreshed_at = now() - interval '6 minutes'");
    const stale = await (await getListings(listingRequest())).json();
    expect(stale).toMatchObject({ partial: false, stale: true });
    expect(stale.listings).toHaveLength(2);
    await vi.waitFor(async () => {
      const current = await rows();
      expect(current.find((row) => row.key === "accounts:candidate:v1:true:true")?.payload).toMatchObject({ catalog: { partial: true } });
      expect(current.find((row) => row.key === "accounts:v2:true:true")?.leaseOwner).toBeNull();
    });
    const complete = (await rows()).find((row) => row.key === "accounts:v2:true:true");
    expect(complete?.payload).toEqual(before);
    const again = await (await getListings(listingRequest())).json();
    expect(again).toMatchObject({ partial: false, stale: true });
    expect(again.listings).toHaveLength(2);
  });
});
